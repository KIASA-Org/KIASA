package modelserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"stealth-app/internal/answers"
)

const (
	// needClarification is the choice a model takes when the facts do not settle a question.
	needClarification = "NEED_CLARIFICATION"

	descriptionLimit = 12000
	careerLimit      = 6000
	hintLimit        = 600
	askLimit         = 280
)

// Model asks Ollama, on this PC, one question at a time.
type Model struct {
	Address string
	Name    string
	Prompt  string
	Client  *http.Client
	// ContextSize is how much text, in tokens, the model holds at once.
	ContextSize int
}

// look asks Ollama whether it is up, and whether it has the model and has it loaded.
func (m *Model) look(ctx context.Context) Health {
	health := Health{Model: m.Name}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	type listed struct {
		Models []struct {
			Name     string `json:"name"`
			Model    string `json:"model"`
			Size     int64  `json:"size"`
			SizeVRAM int64  `json:"size_vram"`
		} `json:"models"`
	}
	read := func(path string, into *listed) bool {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(m.Address, "/")+path, nil)
		if err != nil {
			return false
		}
		res, err := m.Client.Do(req)
		if err != nil {
			return false
		}
		defer res.Body.Close()
		return res.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(into) == nil
	}
	var installed, running listed
	if !read("/api/tags", &installed) {
		return health
	}
	health.Ollama = true
	for _, found := range installed.Models {
		if found.Name == m.Name || found.Model == m.Name {
			health.Installed = true
		}
	}
	if read("/api/ps", &running) {
		for _, found := range running.Models {
			if (found.Name == m.Name || found.Model == m.Name) && found.Size > 0 {
				health.Loaded = true
				health.OnGPU = int(found.SizeVRAM * 100 / found.Size)
			}
		}
	}
	return health
}

// ErrModelOff means Ollama did not answer.
var ErrModelOff = errors.New("the model is not running")

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model     string         `json:"model"`
	Messages  []chatMessage  `json:"messages"`
	Stream    bool           `json:"stream"`
	Think     bool           `json:"think"`
	KeepAlive string         `json:"keep_alive"`
	Format    any            `json:"format,omitempty"`
	Options   map[string]any `json:"options"`
}

func (m *Model) chat(ctx context.Context, user string, format any) (string, error) {
	body, err := json.Marshal(chatRequest{
		Model: m.Name,
		Messages: []chatMessage{
			// The owner's prompt goes first and whole, so that it is the same from one
			// question to the next and the model need not read it again each time.
			{Role: "system", Content: m.Prompt},
			{Role: "user", Content: user},
		},
		Format:    format,
		KeepAlive: "30m",
		Options:   map[string]any{"num_ctx": m.ContextSize, "num_predict": 500, "temperature": 0.2},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(m.Address, "/")+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := m.Client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", ErrModelOff
	}
	defer res.Body.Close()
	reply, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the model answered with status %d", res.StatusCode)
	}
	var out struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(reply, &out); err != nil {
		return "", err
	}
	return out.Message.Content, nil
}

// withoutContactDetails takes out what the model has no need of: how to reach the member
// is copied into forms by the exact rules, and never passes through the model.
func withoutContactDetails(raw json.RawMessage) string {
	var resume map[string]any
	if err := json.Unmarshal(raw, &resume); err != nil {
		return ""
	}
	if info, ok := resume["info"].(map[string]any); ok {
		for _, key := range []string{"name", "email", "phone", "linkedin"} {
			delete(info, key)
		}
	}
	compact, err := json.Marshal(resume)
	if err != nil {
		return ""
	}
	return string(compact)
}

func cut(text string, most int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= most {
		return string(runes)
	}
	return string(runes[:most])
}

// materials is the part of the message that stays the same for all of a job's questions,
// and so comes first: the model then reads it only once per job.
func materials(req *answers.Request) string {
	var b strings.Builder
	b.WriteString("My latest resume, as JSON:\n")
	b.WriteString(withoutContactDetails(req.Resume))
	b.WriteString("\n\nThe complete job description:\n")
	if req.Job.Company != "" {
		fmt.Fprintf(&b, "Company: %s\n", req.Job.Company)
	}
	if req.Job.Title != "" {
		fmt.Fprintf(&b, "Target title: %s\n", req.Job.Title)
	}
	if req.Job.Location != "" {
		fmt.Fprintf(&b, "Location: %s\n", req.Job.Location)
	}
	b.WriteString(cut(req.Job.Description, descriptionLimit))
	var told []answers.Fact
	for _, fact := range req.Info.Facts {
		// The voluntary questions are copied in by the rules: the model has no use for them.
		if !demographicFacts[normal(fact.Question)] {
			told = append(told, fact)
		}
	}
	if len(told) > 0 {
		b.WriteString("\n\nMy explicit factual clarifications:\n")
		for _, fact := range told {
			fmt.Fprintf(&b, "- %s: %s\n", fact.Question, fact.Answer)
		}
	}
	if career := cut(req.Info.Career, careerLimit); career != "" {
		fmt.Fprintf(&b, "\n\nMore about my career, in my own words:\n%s", career)
	}
	return b.String()
}

// questionPart is the question itself, worded by the form. What it says about the form of
// the reply belongs to this message: the owner's prompt is not changed for it.
func questionPart(q answers.Question) string {
	var b strings.Builder
	b.WriteString("\n\nThis question is on the job application form, and I am filling it in now:\n")
	b.WriteString(q.Label)
	if q.Hint != "" {
		fmt.Fprintf(&b, "\n(%s)", cut(q.Hint, hintLimit))
	}
	switch q.Kind {
	case answers.KindChoice, answers.KindMultiChoice:
		fmt.Fprintf(&b, "\n\nThe form only accepts these choices: %s.\nIf my resume and clarifications do not settle it, take %s.", strings.Join(definiteOptions(q.Options), " | "), needClarification)
	case answers.KindText, answers.KindSearch:
		fmt.Fprintf(&b, "\n\nThe form has a one-line box for this: give just the value, not a sentence. If my resume and clarifications do not settle it, give %s.", needClarification)
	}
	return b.String()
}

// saysNoAnswer finds the marker for having no answer, however it was written: it must never
// reach a form.
var saysNoAnswer = regexp.MustCompile(`(?i)need[\s_-]*clarification`)

var (
	thinking  = regexp.MustCompile(`(?is)<think>.*?</think>`)
	suggested = regexp.MustCompile(`(?is)\*{0,2}\s*Suggested Answer\s*:?\s*\*{0,2}\s*:?\s*(.+)$`)
	blank     = regexp.MustCompile(`\[[^\]]{2,}\]`)
)

// parseWritten takes the answer out of a reply in the prompt's own format. A reply that
// has none is the model asking for a detail, which only the member has.
func parseWritten(reply string) (answer string, asked string) {
	reply = strings.TrimSpace(thinking.ReplaceAllString(reply, ""))
	found := suggested.FindStringSubmatch(reply)
	if found == nil {
		return "", reply
	}
	answer = strings.Trim(strings.TrimSpace(found[1]), `"“”`)
	answer = strings.TrimSpace(answer)
	// The prompt rules out unfilled blanks, and a form must never get one.
	if answer == "" || blank.MatchString(answer) || saysNoAnswer.MatchString(answer) {
		return "", reply
	}
	return answer, ""
}

// answer gets the model's reply to one question. An error means the model itself failed,
// which says nothing about the question.
func (m *Model) answer(ctx context.Context, shared string, q answers.Question) (verdict, error) {
	ctx, cancel := context.WithTimeout(ctx, modelTimeout)
	defer cancel()
	message := shared + questionPart(q)
	switch q.Kind {
	case answers.KindChoice, answers.KindMultiChoice:
		return m.choose(ctx, message, q)
	case answers.KindText, answers.KindSearch:
		return m.oneLine(ctx, message, q)
	}
	reply, err := m.chat(ctx, message, nil)
	if err != nil {
		return verdict{}, err
	}
	written, asked := parseWritten(reply)
	if written == "" {
		return noAnswer(q, asked), nil
	}
	return exact(written), nil
}

// noAnswer is the model not being able to say. A required question goes to the member,
// with what the model asked when it asked something short enough to read.
func noAnswer(q answers.Question, asked string) verdict {
	if !q.Required {
		return verdict{decision: leaveOut}
	}
	why := "Your résumé and saved answers do not say."
	if asked = strings.TrimSpace(thinking.ReplaceAllString(asked, "")); asked != "" && !saysNoAnswer.MatchString(asked) && strings.Contains(asked, "?") && len([]rune(asked)) <= askLimit {
		why = asked
	}
	return member(why)
}

// choose makes the model pick from the form's choices. The reply's shape is held to them
// by Ollama, and checked again here: a reply that is not on the list is no answer.
func (m *Model) choose(ctx context.Context, message string, q answers.Question) (verdict, error) {
	allowed := append(append([]string{}, definiteOptions(q.Options)...), needClarification)
	if q.Kind == answers.KindMultiChoice {
		reply, err := m.chat(ctx, message, map[string]any{
			"type":       "object",
			"properties": map[string]any{"answer": map[string]any{"type": "array", "items": map[string]any{"type": "string", "enum": allowed}}},
			"required":   []string{"answer"},
		})
		if err != nil {
			return verdict{}, err
		}
		var out struct {
			Answer []string `json:"answer"`
		}
		if err := json.Unmarshal([]byte(reply), &out); err != nil || len(out.Answer) == 0 {
			return noAnswer(q, ""), nil
		}
		var chosen []string
		for _, value := range out.Answer {
			option, ok := optionFor(q.Options, value)
			if !ok {
				return noAnswer(q, ""), nil
			}
			chosen = append(chosen, option)
		}
		return exact(chosen...), nil
	}
	reply, err := m.chat(ctx, message, map[string]any{
		"type":       "object",
		"properties": map[string]any{"answer": map[string]any{"type": "string", "enum": allowed}},
		"required":   []string{"answer"},
	})
	if err != nil {
		return verdict{}, err
	}
	var out struct {
		Answer string `json:"answer"`
	}
	if err := json.Unmarshal([]byte(reply), &out); err != nil {
		return noAnswer(q, ""), nil
	}
	option, ok := optionFor(q.Options, out.Answer)
	if !ok {
		return noAnswer(q, ""), nil
	}
	return exact(option), nil
}

// oneLine gets a bare value for a one-line box.
func (m *Model) oneLine(ctx context.Context, message string, q answers.Question) (verdict, error) {
	reply, err := m.chat(ctx, message, map[string]any{
		"type":       "object",
		"properties": map[string]any{"answer": map[string]any{"type": "string"}},
		"required":   []string{"answer"},
	})
	if err != nil {
		return verdict{}, err
	}
	var out struct {
		Answer string `json:"answer"`
	}
	if err := json.Unmarshal([]byte(reply), &out); err != nil {
		return noAnswer(q, ""), nil
	}
	value := strings.TrimSpace(out.Answer)
	if value == "" || saysNoAnswer.MatchString(value) || blank.MatchString(value) {
		return noAnswer(q, ""), nil
	}
	return exact(value), nil
}

// modelTimeout is the longest one answer may take.
const modelTimeout = 3 * time.Minute
