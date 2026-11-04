package modelserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"stealth-app/internal/answers"
)

const (
	bodyLimit      = 512 << 10
	questionsLimit = 80
	labelLimit     = 3000
	optionsLimit   = 400
	// A busy day is 100 applications, some of them read twice for follow-up questions.
	memberDayLimit = 400
	badKeysLimit   = 60 // a minute, from anyone: then nobody's key is even looked up

	keepKeyFor    = 5 * time.Minute
	keepAnswerFor = 5 * time.Minute
	abandonAfter  = 90 * time.Second
	sweepEvery    = 15 * time.Second
)

// ErrRefused means KIASA does not know the browser's key.
var ErrRefused = errors.New("this browser is not connected to KIASA")

// Config is what a server needs.
type Config struct {
	Model *Model
	// Check says which member a browser's key belongs to, or returns ErrRefused.
	Check func(ctx context.Context, key string) (string, error)
	// Workers is how many requests the model works on at once.
	Workers int
}

// Server answers browsers. What it was sent lives in memory only, and only until the
// answers have been made; it writes no question, answer or résumé to its log.
type Server struct {
	cfg  Config
	wake chan struct{}

	mu      sync.Mutex
	tickets map[string]*ticket
	queue   []*ticket
	keys    map[string]knownKey
	days    map[string]*memberDay
	badKeys int
	badFrom time.Time

	seen        map[string]*memberSeen
	answered    int
	failed      int
	totalTime   time.Duration
	lastAnswer  time.Time
	lastFailure time.Time
}

// memberSeen is when a member's browser last reached this server, and how much it has asked.
type memberSeen struct {
	last     time.Time
	requests int
}

// connectedFor is how long since a browser was last heard from it still counts as connected.
// Browsers check in every 20 seconds or so.
const connectedFor = 90 * time.Second

// Connected is one member whose browser has reached this server lately.
type Connected struct {
	Member     string `json:"member"`
	SecondsAgo int    `json:"seconds_ago"`
	Requests   int    `json:"requests"`
}

// Health is how the model is, for the admins. It holds no question or answer.
type Health struct {
	Ollama                bool    `json:"ollama"`
	Model                 string  `json:"model"`
	Installed             bool    `json:"installed"`
	Loaded                bool    `json:"loaded"`
	OnGPU                 int     `json:"on_gpu"`
	Answered              int     `json:"answered"`
	Failed                int     `json:"failed"`
	AverageSeconds        float64 `json:"average_seconds"`
	LastAnswerSecondsAgo  *int    `json:"last_answer_seconds_ago"`
	LastFailureSecondsAgo *int    `json:"last_failure_seconds_ago"`
}

type ticket struct {
	id       string
	member   string
	req      *answers.Request
	state    string
	reply    *answers.Reply
	failure  string
	polled   time.Time
	finished time.Time
	cancel   context.CancelFunc
}

type knownKey struct {
	member string
	until  time.Time
}

type memberDay struct {
	count int
	since time.Time
}

// Waiting says how many requests are queued or being worked on.
func (s *Server) Waiting() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, t := range s.tickets {
		if t.finished.IsZero() {
			count++
		}
	}
	return count
}

// ConnectedNow lists the members whose browsers have reached this server lately.
func (s *Server) ConnectedNow() []Connected {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	out := make([]Connected, 0, len(s.seen))
	for member, seen := range s.seen {
		if now.Sub(seen.last) <= connectedFor {
			out = append(out, Connected{Member: member, SecondsAgo: int(now.Sub(seen.last).Seconds()), Requests: seen.requests})
		}
	}
	return out
}

// HealthNow looks at Ollama, and adds how the answers have gone since this server started.
func (s *Server) HealthNow(ctx context.Context) Health {
	health := s.cfg.Model.look(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	health.Answered, health.Failed = s.answered, s.failed
	if s.answered > 0 {
		health.AverageSeconds = float64(int(s.totalTime.Seconds()/float64(s.answered)*10)) / 10
	}
	now := time.Now()
	if !s.lastAnswer.IsZero() {
		seconds := int(now.Sub(s.lastAnswer).Seconds())
		health.LastAnswerSecondsAgo = &seconds
	}
	if !s.lastFailure.IsZero() {
		seconds := int(now.Sub(s.lastFailure).Seconds())
		health.LastFailureSecondsAgo = &seconds
	}
	return health
}

// New returns a server. Run starts its work.
func New(cfg Config) *Server {
	if cfg.Workers < 1 {
		cfg.Workers = 1
	}
	return &Server{
		cfg:     cfg,
		wake:    make(chan struct{}, 1),
		tickets: map[string]*ticket{},
		keys:    map[string]knownKey{},
		days:    map[string]*memberDay{},
		seen:    map[string]*memberSeen{},
	}
}

// Run does the queued work until ctx ends.
func (s *Server) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < s.cfg.Workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.work(ctx)
		}()
	}
	tick := time.NewTicker(sweepEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			return
		case <-tick.C:
			s.sweep(time.Now())
		}
	}
}

func (s *Server) work(ctx context.Context) {
	for {
		t := s.next()
		if t == nil {
			select {
			case <-ctx.Done():
				return
			case <-s.wake:
				continue
			case <-time.After(time.Second):
				continue
			}
		}
		s.process(ctx, t)
	}
}

func (s *Server) next() *ticket {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queue) == 0 {
		return nil
	}
	t := s.queue[0]
	s.queue = s.queue[1:]
	t.state = answers.StateWorking
	return t
}

// process answers a request's questions in the order the form asks them.
func (s *Server) process(parent context.Context, t *ticket) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	s.mu.Lock()
	t.cancel = cancel
	req := t.req
	s.mu.Unlock()
	if req == nil {
		return
	}

	started := time.Now()
	reply := answers.Reply{Answers: []answers.Answer{}, Asks: []answers.Ask{}}
	shared := materials(req)
	resume := readResume(req.Resume)
	written := 0
	// A form the agent should not go on with is found before the model is asked anything.
	for _, q := range req.Questions {
		if v := decide(q, req, resume); v.decision == stopJob {
			reply.Stop = v.why
			s.finish(t, &reply, nil)
			log.Println("[+] A form was left for its member, without asking the model.")
			return
		}
	}
	for _, q := range req.Questions {
		v := decide(q, req, resume)
		if v.decision == askModel {
			written++
			var err error
			if v, err = s.cfg.Model.answer(ctx, shared, q); err != nil {
				s.finish(t, nil, err)
				// A browser that went away, or a server stopping, is no failure of the model's.
				if ctx.Err() == nil {
					s.noteFailure()
				}
				log.Printf("[!] A request stopped after %d answers: %v\n", written-1, err)
				return
			}
		}
		switch v.decision {
		case answered:
			reply.Answers = append(reply.Answers, answers.Answer{ID: q.ID, Values: v.values})
		case askMember:
			label := q.Label
			if v.askAs != "" {
				label = v.askAs
			}
			reply.Asks = append(reply.Asks, answers.Ask{ID: q.ID, Label: label, Why: v.why, Kind: q.Kind, Options: q.Options})
		}
	}
	s.finish(t, &reply, nil)
	s.noteAnswer(t.member, time.Since(started))
	log.Printf("[+] Answered %d questions, %d by the model, %d left for the member, in %.0fs\n", len(req.Questions), written, len(reply.Asks), time.Since(started).Seconds())
}

func (s *Server) noteAnswer(member string, took time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.answered++
	s.totalTime += took
	s.lastAnswer = time.Now()
	if seen := s.seen[member]; seen != nil {
		seen.requests++
	}
}

func (s *Server) noteFailure() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failed++
	s.lastFailure = time.Now()
}

// noteSeenLocked records that a member's browser reached this server.
func (s *Server) noteSeenLocked(member string, at time.Time) {
	seen := s.seen[member]
	if seen == nil {
		seen = &memberSeen{}
		s.seen[member] = seen
	}
	seen.last = at
}

// finish keeps the outcome for a short while and drops what was sent.
func (s *Server) finish(t *ticket, reply *answers.Reply, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t.req = nil
	t.finished = time.Now()
	if err != nil {
		t.state, t.failure = answers.StateFailed, "The model could not answer just now."
		return
	}
	t.state, t.reply = answers.StateDone, reply
}

// sweep forgets finished work, and stops work for a browser that stopped asking after it.
func (s *Server) sweep(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, t := range s.tickets {
		switch {
		case !t.finished.IsZero():
			if now.Sub(t.finished) > keepAnswerFor {
				delete(s.tickets, id)
			}
		case now.Sub(t.polled) > abandonAfter:
			s.dropLocked(t)
		}
	}
	for key, known := range s.keys {
		if now.After(known.until) {
			delete(s.keys, key)
		}
	}
	for who, day := range s.days {
		if now.Sub(day.since) > 24*time.Hour {
			delete(s.days, who)
		}
	}
	// Their count stays while the server runs, as long as they keep coming back within a day.
	for who, seen := range s.seen {
		if now.Sub(seen.last) > 24*time.Hour {
			delete(s.seen, who)
		}
	}
}

// dropLocked forgets a ticket, and stops it if it is being worked on.
func (s *Server) dropLocked(t *ticket) {
	if t.cancel != nil {
		t.cancel()
	}
	for i, queued := range s.queue {
		if queued == t {
			s.queue = append(s.queue[:i], s.queue[i+1:]...)
			break
		}
	}
	t.req = nil
	delete(s.tickets, t.id)
}

// Handler is the server's address book. It is meant to be reached through the tunnel.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /v1/ping", s.ping)
	mux.HandleFunc("POST /v1/answers", s.create)
	mux.HandleFunc("GET /v1/answers/{ticket}", s.progress)
	mux.HandleFunc("DELETE /v1/answers/{ticket}", s.remove)
	return mux
}

func say(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func refuse(w http.ResponseWriter, status int, message string) {
	say(w, status, map[string]string{"error": message})
}

// ping is a browser saying it is here, which is how the admins see who is connected.
func (s *Server) ping(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.who(w, r); ok {
		say(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// health says whether the model is ready, so a browser can tell "server off" from "busy".
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	ready := false
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.cfg.Model.Address, "/")+"/api/tags", nil)
	if err == nil {
		if res, err := s.cfg.Model.Client.Do(req); err == nil {
			res.Body.Close()
			ready = res.StatusCode == http.StatusOK
		}
	}
	say(w, http.StatusOK, map[string]bool{"ok": ready})
}

// who says which member is asking. A key is looked up once in a while, not on every poll.
func (s *Server) who(w http.ResponseWriter, r *http.Request) (string, bool) {
	key, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || key == "" || len(key) > 200 {
		refuse(w, http.StatusUnauthorized, ErrRefused.Error())
		return "", false
	}
	sum := sha256.Sum256([]byte(key))
	hashed := hex.EncodeToString(sum[:])

	now := time.Now()
	s.mu.Lock()
	if known, ok := s.keys[hashed]; ok && now.Before(known.until) {
		s.noteSeenLocked(known.member, now)
		s.mu.Unlock()
		return known.member, true
	}
	if now.Sub(s.badFrom) > time.Minute {
		s.badFrom, s.badKeys = now, 0
	}
	tooMany := s.badKeys >= badKeysLimit
	s.mu.Unlock()
	if tooMany {
		refuse(w, http.StatusTooManyRequests, "Too many tries. Wait a minute.")
		return "", false
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	member, err := s.cfg.Check(ctx, key)
	if errors.Is(err, ErrRefused) {
		s.mu.Lock()
		s.badKeys++
		s.mu.Unlock()
		refuse(w, http.StatusUnauthorized, ErrRefused.Error())
		return "", false
	}
	if err != nil || member == "" {
		refuse(w, http.StatusServiceUnavailable, "Could not reach KIASA to check this browser.")
		return "", false
	}
	s.mu.Lock()
	s.keys[hashed] = knownKey{member: member, until: now.Add(keepKeyFor)}
	s.noteSeenLocked(member, now)
	s.mu.Unlock()
	return member, true
}

func valid(req *answers.Request) string {
	if len(req.Questions) == 0 || len(req.Questions) > questionsLimit {
		return "A request must hold between 1 and 80 questions."
	}
	var resume map[string]any
	if err := json.Unmarshal(req.Resume, &resume); err != nil || len(resume) == 0 {
		return "A request must hold the member's résumé."
	}
	for _, q := range req.Questions {
		if q.ID == "" || q.Label == "" || len(q.Label) > labelLimit || len(q.Options) > optionsLimit {
			return "A question in this request cannot be read."
		}
	}
	return ""
}

// create takes a job's questions into the queue. A member has one request at a time: a new
// one replaces any before it, as when the browser was restarted part way through a job.
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	member, ok := s.who(w, r)
	if !ok {
		return
	}
	var req answers.Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, bodyLimit)).Decode(&req); err != nil {
		refuse(w, http.StatusBadRequest, "This request cannot be read.")
		return
	}
	if problem := valid(&req); problem != "" {
		refuse(w, http.StatusBadRequest, problem)
		return
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		refuse(w, http.StatusInternalServerError, "Please try again.")
		return
	}
	t := &ticket{id: hex.EncodeToString(id[:]), member: member, req: &req, state: answers.StateQueued, polled: time.Now()}

	s.mu.Lock()
	day := s.days[member]
	if day == nil || time.Since(day.since) > 24*time.Hour {
		day = &memberDay{since: time.Now()}
		s.days[member] = day
	}
	if day.count >= memberDayLimit {
		s.mu.Unlock()
		refuse(w, http.StatusTooManyRequests, "This member has reached the day's limit.")
		return
	}
	day.count++
	for _, old := range s.tickets {
		if old.member == member && old.finished.IsZero() {
			s.dropLocked(old)
		}
	}
	s.tickets[t.id] = t
	s.queue = append(s.queue, t)
	position := len(s.queue) - 1
	s.mu.Unlock()

	select {
	case s.wake <- struct{}{}:
	default:
	}
	say(w, http.StatusAccepted, answers.Progress{Ticket: t.id, State: answers.StateQueued, Position: position})
}

// mine finds a ticket for the member who owns it. Someone else's looks like no ticket at all.
func (s *Server) mine(member, id string) *ticket {
	t := s.tickets[id]
	if t == nil || t.member != member {
		return nil
	}
	return t
}

func (s *Server) progress(w http.ResponseWriter, r *http.Request) {
	member, ok := s.who(w, r)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.mine(member, r.PathValue("ticket"))
	if t == nil {
		refuse(w, http.StatusNotFound, "This request is not known.")
		return
	}
	t.polled = time.Now()
	out := answers.Progress{Ticket: t.id, State: t.state, Reply: t.reply, Error: t.failure}
	for i, queued := range s.queue {
		if queued == t {
			out.Position = i
			break
		}
	}
	say(w, http.StatusOK, out)
}

// remove stops a request, as when the member or an admin presses Stop.
func (s *Server) remove(w http.ResponseWriter, r *http.Request) {
	member, ok := s.who(w, r)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if t := s.mine(member, r.PathValue("ticket")); t != nil {
		s.dropLocked(t)
	}
	w.WriteHeader(http.StatusNoContent)
}
