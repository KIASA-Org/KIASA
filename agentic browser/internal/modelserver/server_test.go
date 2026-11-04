package modelserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"stealth-app/internal/answers"
)

// fakeOllama records what it was asked and replies through the given function.
type fakeOllama struct {
	mu    sync.Mutex
	asked []chatRequest
	reply func(chatRequest) (string, int)
	srv   *httptest.Server
}

func newFakeOllama(t *testing.T, reply func(chatRequest) (string, int)) *fakeOllama {
	t.Helper()
	f := &fakeOllama{reply: reply}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tags" {
			w.Write([]byte(`{"models":[{"name":"test-model","model":"test-model"},{"name":"another","model":"another"}]}`))
			return
		}
		if r.URL.Path == "/api/ps" {
			w.Write([]byte(`{"models":[{"name":"test-model","model":"test-model","size":1000,"size_vram":750}]}`))
			return
		}
		var req chatRequest
		json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		f.asked = append(f.asked, req)
		f.mu.Unlock()
		text, status := f.reply(req)
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"message": map[string]string{"role": "assistant", "content": text}})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeOllama) requests() []chatRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]chatRequest{}, f.asked...)
}

const goodKey = "kapp_member_one_key_that_is_long_enough"

// start runs a server in front of the fake, and returns its address.
func start(t *testing.T, f *fakeOllama) (string, *Server) {
	t.Helper()
	s := New(Config{
		Model: &Model{Address: f.srv.URL, Name: "test-model", Prompt: Prompt(), Client: f.srv.Client(), ContextSize: 8192},
		Check: func(_ context.Context, key string) (string, error) {
			switch key {
			case goodKey:
				return "member-1", nil
			case "kapp_member_two_key_that_is_long_enough":
				return "member-2", nil
			case "kapp_kiasa_is_unreachable_right_now_key":
				return "", errors.New("no connection")
			}
			return "", ErrRefused
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.Run(ctx)
		close(done)
	}()
	front := httptest.NewServer(s.Handler())
	t.Cleanup(func() {
		front.Close()
		cancel()
		<-done
	})
	return front.URL, s
}

func call(t *testing.T, method, address, key string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		packed, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(packed)
	}
	req, err := http.NewRequest(method, address, reader)
	if err != nil {
		t.Fatal(err)
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res, out
}

// ask sends a request and waits for its outcome.
func ask(t *testing.T, address, key string, req answers.Request) answers.Progress {
	t.Helper()
	res, body := call(t, http.MethodPost, address+"/v1/answers", key, req)
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("create: status %d: %s", res.StatusCode, body)
	}
	var got answers.Progress
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		_, body := call(t, http.MethodGet, address+"/v1/answers/"+got.Ticket, key, nil)
		var now answers.Progress
		if err := json.Unmarshal(body, &now); err != nil {
			t.Fatal(err)
		}
		if now.State == answers.StateDone || now.State == answers.StateFailed {
			return now
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the request never finished")
	return got
}

const sampleResume = `{
	"info": {"name": "Ana Test", "title": "Backend Engineer", "location": "Boston", "email": "ana@example.com", "phone": "+1 555 0100", "linkedin": "https://linkedin.com/in/anatest"},
	"summary": "Backend engineer.",
	"experience": [{"title": "Engineer", "company": "Acme", "startDate": "2020", "endDate": "2024", "location": "Boston", "descriptionLines": ["Built the billing service in Go."]}],
	"education": [{"degree": "Bachelor of Science", "major": "Computer Science", "school": "Boston University", "startDate": "2014", "endDate": "2018"}]
}`

func sampleRequest(questions ...answers.Question) answers.Request {
	return answers.Request{
		Job:    answers.Job{Company: "Example Co", Title: "Backend Engineer", Description: "We build billing systems in Go."},
		Resume: json.RawMessage(sampleResume),
		Info: answers.Info{
			FirstName: "Ana", LastName: "Test", Email: "ana@example.com", Phone: "+1 555 0100",
			Country: "United States", City: "Boston", LinkedIn: "https://linkedin.com/in/anatest",
			Facts: []answers.Fact{{Question: "Are you authorized to work in the United States?", Answer: "Yes"}},
		},
		Questions: questions,
	}
}

func valuesOf(reply *answers.Reply) map[string][]string {
	out := map[string][]string{}
	for _, answer := range reply.Answers {
		out[answer.ID] = answer.Values
	}
	return out
}

func whyOf(reply *answers.Reply) map[string]string {
	out := map[string]string{}
	for _, ask := range reply.Asks {
		out[ask.ID] = ask.Why
	}
	return out
}

func TestPrompt_IsWordForWordWhatTheOwnerGave(t *testing.T) {
	if got := checksum(Prompt()); got != promptChecksum {
		t.Fatalf("the prompt has changed: checksum %s", got)
	}
}

func TestModel_GetsThePromptUnchangedAndFirst(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		return "**Suggested Answer:**\n“Because of the billing work.”", 200
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(answers.Question{ID: "q1", Kind: answers.KindLongText, Label: "Why do you want to work here?", Required: true}))
	if got.State != answers.StateDone {
		t.Fatalf("state %s: %s", got.State, got.Error)
	}
	asked := f.requests()
	if len(asked) != 1 {
		t.Fatalf("the model was asked %d times", len(asked))
	}
	if asked[0].Messages[0].Role != "system" || asked[0].Messages[0].Content != Prompt() {
		t.Error("the system message must be the prompt, byte for byte")
	}
	if asked[0].Model != "test-model" {
		t.Errorf("model %q", asked[0].Model)
	}
	message := asked[0].Messages[1].Content
	for _, part := range []string{"We build billing systems in Go.", "Built the billing service in Go.", "Why do you want to work here?", "Example Co", "Are you authorized"} {
		if !strings.Contains(message, part) {
			t.Errorf("the message should hold %q", part)
		}
	}
	if values := valuesOf(got.Reply)["q1"]; len(values) != 1 || values[0] != "Because of the billing work." {
		t.Errorf("answer = %v", values)
	}
}

func TestModel_NeverSeesHowToReachTheMember(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“Fine.”", 200 })
	address, _ := start(t, f)
	ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "email", Kind: answers.KindText, Label: "Email", Required: true},
		answers.Question{ID: "q1", Kind: answers.KindLongText, Label: "Why here?", Required: true},
	))
	for _, request := range f.requests() {
		for _, message := range request.Messages {
			for _, secret := range []string{"ana@example.com", "555 0100", "Ana Test", "linkedin.com/in/anatest"} {
				if strings.Contains(message.Content, secret) {
					t.Errorf("the model was sent %q", secret)
				}
			}
		}
	}
}

func TestWhereTheMemberLives_IsNeverLeftToTheModel(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked where someone lives")
		return "", 500
	})
	address, _ := start(t, f)
	longList := []string{"Indiana", "Iowa", "Massachusetts", "Other"}
	shortList := []string{"IA", "IN", "MA", "NY"}
	req := sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "State (If you are outside of the United States, select Other)", Required: true, Options: longList},
		answers.Question{ID: "b", Kind: answers.KindChoice, Label: "State of Residence", Required: true, Options: shortList},
		answers.Question{ID: "c", Kind: answers.KindChoice, Label: "What US state do you reside in?", Options: longList},
		answers.Question{ID: "d", Kind: answers.KindText, Label: "Zip Code", Required: true},
		answers.Question{ID: "e", Kind: answers.KindText, Label: "City", Required: true},
		answers.Question{ID: "f", Kind: answers.KindText, Label: "What is your present address?", Required: true},
		answers.Question{ID: "g", Kind: answers.KindText, Label: "Linked In Profile"},
	)
	req.Resume = json.RawMessage(`{"info": {"location": "Boston, MA", "linkedin": "https://linkedin.com/in/fromresume"}}`)
	req.Info.Zip = "02108"
	req.Info.Address = "1 Main St"
	req.Info.LinkedIn = ""
	values := valuesOf(ask(t, address, goodKey, req).Reply)
	want := map[string]string{"a": "Massachusetts", "b": "MA", "c": "Massachusetts", "d": "02108", "e": "Boston", "f": "1 Main St", "g": "https://linkedin.com/in/fromresume"}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	// A state the member has saved comes before the résumé's.
	req.Info.State = "Iowa"
	values = valuesOf(ask(t, address, goodKey, req).Reply)
	if values["a"][0] != "Iowa" || values["b"][0] != "IA" {
		t.Errorf("values = %v", values)
	}
}

func TestAStateNotOnTheFormsList_IsNeverReplacedByAnother(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	req := sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "State of Residence", Required: true, Options: []string{"IL", "IN", "NY"}},
		answers.Question{ID: "b", Kind: answers.KindChoice, Label: "What US state do you reside in?", Options: []string{"Illinois", "Indiana"}},
	)
	req.Info.State = "MA"
	got := ask(t, address, goodKey, req)
	if !strings.Contains(whyOf(got.Reply)["a"], "not one of this form's choices") {
		t.Errorf("why = %v", whyOf(got.Reply))
	}
	if len(got.Reply.Answers) != 0 {
		t.Errorf("answers = %+v", got.Reply.Answers)
	}
}

func TestIdentifyAs_CisgenderOrTransgender(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	decline := "I don't wish to answer"
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindChoice, Label: "I identify as:", Required: true, Options: []string{"Cisgender", "Transgender", "I prefer to self-describe", decline}})
	req.Info.Facts = []answers.Fact{{Question: "LGBTQ+", Answer: "No"}}
	if values := valuesOf(ask(t, address, goodKey, req).Reply); len(values["a"]) != 1 || values["a"][0] != "Cisgender" {
		t.Errorf("values = %v", values)
	}
	req.Info.Facts = nil
	if values := valuesOf(ask(t, address, goodKey, req).Reply); len(values["a"]) != 1 || values["a"][0] != decline {
		t.Errorf("nothing saved: values = %v", values)
	}
}

func TestStateAndZip_UnknownGoToTheMemberNotTheModel(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	req := sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "State of Residence", Required: true, Options: []string{"IA", "MA"}},
		answers.Question{ID: "b", Kind: answers.KindText, Label: "Postal Code", Required: true},
	)
	req.Resume = json.RawMessage(`{"info": {"location": "Berlin"}}`)
	why := whyOf(ask(t, address, goodKey, req).Reply)
	if !strings.Contains(why["a"], "state") || !strings.Contains(why["b"], "zip") {
		t.Errorf("why = %v", why)
	}
}

func TestOtherStateWords_AreNotMistakenForAStateQuestion(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return `{"answer":"Fine"}`, 200 })
	address, _ := start(t, f)
	ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindText, Label: "Please state your reason for applying", Required: true},
		answers.Question{ID: "b", Kind: answers.KindText, Label: "What is the current state of your job search?", Required: true},
	))
	if asked := f.requests(); len(asked) != 2 {
		t.Errorf("both go to the model: asked %d times", len(asked))
	}
}

func TestDemographics_WhatTheSavedAnswersSettle(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should never be asked about these")
		return "", 500
	})
	address, _ := start(t, f)
	decline := "I don't wish to answer"
	questions := []answers.Question{
		{ID: "i", Kind: answers.KindChoice, Label: "I identify as:", Options: []string{"Woman", "Man", "I prefer to self-describe", decline}},
		{ID: "e", Kind: answers.KindMultiChoice, Label: "Please select up to 2 ethnicities that you most closely identify with.", Required: true, Options: []string{"Asian", "White", decline}},
		{ID: "t", Kind: answers.KindChoice, Label: "Are you a person of transgender experience?", Options: []string{"Yes", "No", decline}},
		{ID: "o", Kind: answers.KindMultiChoice, Label: "What sexual orientation do you most closely identify with?", Options: []string{"Bisexual", "Heterosexual", "Queer", decline}},
		{ID: "p", Kind: answers.KindMultiChoice, Label: "What are your pronouns?", Options: []string{"She/Her", "He/Him", "They/Them", "Prefer not to say", "Other"}},
	}
	req := sampleRequest(questions...)
	req.Info.Facts = []answers.Fact{{Question: "Gender", Answer: "Female"}, {Question: "Race", Answer: "White"}, {Question: "LGBTQ+", Answer: "No"}}
	values := valuesOf(ask(t, address, goodKey, req).Reply)
	want := map[string]string{"i": "Woman", "e": "White", "t": "No", "o": "Heterosexual", "p": "She/Her"}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	// Without those saved answers, nothing is assumed.
	req.Info.Facts = nil
	values = valuesOf(ask(t, address, goodKey, req).Reply)
	for _, id := range []string{"i", "e", "t", "o"} {
		if len(values[id]) != 1 || values[id][0] != decline {
			t.Errorf("nothing saved, %s = %v, want it declined", id, values[id])
		}
	}
	if len(values["p"]) != 1 || values["p"][0] != "Prefer not to say" {
		t.Errorf("nothing saved, pronouns = %v", values["p"])
	}
}

func TestWorkRestrictions_NeedTheMembersOwnAnswer(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked with nothing saved")
		return "", 500
	})
	address, _ := start(t, f)
	yesNo := []string{"Yes", "No"}
	req := sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "Are you bound by any restrictive covenants (non-compete, non-solicit)?", Required: true, Options: yesNo},
		answers.Question{ID: "b", Kind: answers.KindChoice, Label: "Are you subject to any employment agreements and/or post-employment obligations?", Required: true, Options: yesNo},
		answers.Question{ID: "c", Kind: answers.KindChoice, Label: "Have you ever been debarred in your industry?", Required: true, Options: yesNo},
	)
	req.Info.Facts = nil
	why := whyOf(ask(t, address, goodKey, req).Reply)
	for _, id := range []string{"a", "b", "c"} {
		if !strings.Contains(why[id], "Only you can answer") {
			t.Errorf("%s: %q", id, why[id])
		}
	}
}

func TestAStatementInItsChoices_IsAStatement(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "g", Kind: answers.KindChoice, Label: "GDPR", Required: true, Options: []string{"Acknowledge / Confirm"}})
	why := whyOf(ask(t, address, goodKey, req).Reply)
	if !strings.Contains(why["g"], "statement you make yourself") {
		t.Errorf("why = %v", why)
	}
	req.Info.AgreeForMe = "yes"
	values := valuesOf(ask(t, address, goodKey, req).Reply)
	if len(values["g"]) != 1 || values["g"][0] != "Acknowledge / Confirm" {
		t.Errorf("values = %v", values)
	}
}

func TestNames_AreNeverLeftToTheModel(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked for a name")
		return "", 500
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "preferred_name", Kind: answers.KindText, Label: "Preferred First Name"},
		answers.Question{ID: "q1", Kind: answers.KindText, Label: "Preferred name"},
		answers.Question{ID: "q2", Kind: answers.KindText, Label: "Legal First Name", Required: true},
	))
	values := valuesOf(got.Reply)
	for _, id := range []string{"preferred_name", "q1", "q2"} {
		if len(values[id]) != 1 || values[id][0] != "Ana" {
			t.Errorf("%s = %v", id, values[id])
		}
	}
}

func TestDegrees_MatchWhatTheResumeSays(t *testing.T) {
	realList := []string{"Associate's Degree", "Bachelor's Degree", "Doctor of Medicine (M.D.)", "Doctor of Philosophy (Ph.D.)", "Juris Doctor (J.D.)", "Master of Business Administration (M.B.A.)", "Master's Degree", "High School Diploma", "Other"}
	detailed := []string{"Bachelor of Arts", "Bachelor of Science (B.S.)", "Master of Business Administration", "Master of Science (M.S.)", "Other"}
	levelsOnly := []string{"Bachelors", "Masters", "MBA", "PhD"}
	cases := []struct {
		value   string
		options []string
		want    string
	}{
		{"Master of Science", realList, "Master's Degree"},
		{"Bachelor of Science", realList, "Bachelor's Degree"},
		{"MBA", realList, "Master of Business Administration (M.B.A.)"},
		{"Master of Business Administration", realList, "Master of Business Administration (M.B.A.)"},
		{"Master of Science", detailed, "Master of Science (M.S.)"},
		{"Bachelor of Science", detailed, "Bachelor of Science (B.S.)"},
		{"Master of Science", levelsOnly, "Masters"},
		{"Bachelor of Arts", levelsOnly, "Bachelors"},
		{"Master of Fine Arts", detailed, ""},
		{"Certificate", realList, ""},
		{"Master of Science", []string{"Bachelors", "MBA"}, ""},
	}
	for _, c := range cases {
		got, ok := closestDegree(c.options, c.value)
		if got != c.want || ok != (c.want != "") {
			t.Errorf("closestDegree(%q) = %q, want %q", c.value, got, c.want)
		}
	}
}

func TestExactDetails_AreCopiedAndNeverGoToTheModel(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "first_name", Kind: answers.KindText, Label: "First Name", Required: true},
		answers.Question{ID: "last_name", Kind: answers.KindText, Label: "Last Name", Required: true},
		answers.Question{ID: "email", Kind: answers.KindText, Label: "Email", Required: true},
		answers.Question{ID: "phone", Kind: answers.KindText, Label: "Phone", Required: true},
		answers.Question{ID: "country", Kind: answers.KindChoice, Label: "Country", Required: true, Options: []string{"Canada +1", "United States +1"}},
		answers.Question{ID: "candidate-location", Kind: answers.KindSearch, Label: "Location (City)", Required: true},
		answers.Question{ID: "q_li", Kind: answers.KindText, Label: "LinkedIn Profile"},
		answers.Question{ID: "school--0", Kind: answers.KindSearch, Label: "School"},
		answers.Question{ID: "degree--0", Kind: answers.KindChoice, Label: "Degree", Options: []string{"Master's Degree", "Bachelor's Degree"}},
		answers.Question{ID: "discipline--0", Kind: answers.KindSearch, Label: "Discipline"},
		answers.Question{ID: "resume", Kind: answers.KindFile, Label: "Resume/CV", Required: true},
		answers.Question{ID: "q_auth", Kind: answers.KindChoice, Label: "Are you authorized to work in the United States?", Required: true, Options: []string{"Yes", "No"}},
	))
	values := valuesOf(got.Reply)
	want := map[string]string{
		"first_name":         "Ana",
		"last_name":          "Test",
		"email":              "ana@example.com",
		"phone":              "+1 555 0100",
		"country":            "United States +1",
		"candidate-location": "Boston",
		"q_li":               "https://linkedin.com/in/anatest",
		"school--0":          "Boston University",
		"degree--0":          "Bachelor's Degree",
		"discipline--0":      "Computer Science",
		"q_auth":             "Yes",
	}
	for id, value := range want {
		if len(values[id]) == 0 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	if _, ok := values["resume"]; ok {
		t.Error("files are the browser's to attach")
	}
	if len(got.Reply.Asks) != 0 {
		t.Errorf("asks = %+v", got.Reply.Asks)
	}
}

func TestEducation_SearchesUseTheResumesWording(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "school--0", Kind: answers.KindSearch, Label: "School", Required: true},
		answers.Question{ID: "degree--0", Kind: answers.KindSearch, Label: "Degree", Required: true},
		answers.Question{ID: "discipline--0", Kind: answers.KindSearch, Label: "Discipline", Required: true},
		answers.Question{ID: "school--1", Kind: answers.KindSearch, Label: "School", Required: true},
	))
	values := valuesOf(got.Reply)
	if strings.Join(values["school--0"], "|") != "Boston University|Other" {
		t.Errorf("school = %v", values["school--0"])
	}
	if strings.Join(values["degree--0"], "|") != "Bachelor of Science|Bachelor" {
		t.Errorf("a degree never falls back to Other: %v", values["degree--0"])
	}
	if strings.Join(values["discipline--0"], "|") != "Computer Science|Other" {
		t.Errorf("discipline = %v", values["discipline--0"])
	}
	if !strings.Contains(whyOf(got.Reply)["school--1"], "education on your") {
		t.Errorf("a second school the résumé does not have goes to the member: %v", whyOf(got.Reply))
	}
}

const historyResume = `{
	"info": {"title": "Engineer"},
	"experience": [
		{"title": "Senior Engineer", "company": "Northwind", "startDate": "May 2021", "endDate": "Present"},
		{"title": "Engineer", "company": "Contoso", "startDate": "06/2017", "endDate": "April 2021"},
		{"title": "Junior", "company": "Fabrikam", "startDate": "2015", "endDate": "2017"}
	],
	"education": [
		{"degree": "Bachelor of Science", "major": "Computer Science", "school": "Boston University", "startDate": "2013", "endDate": "2017"},
		{"degree": "Master of Science", "major": "Computer Science", "school": "Northeastern University", "startDate": "Sep 2018", "endDate": "2020"}
	]
}`

func TestHistory_IsCopiedExactlyAndNeverGuessed(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked about any of this")
		return "", 500
	})
	address, _ := start(t, f)
	monthList := []string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}
	month := func(id string, required bool) answers.Question {
		return answers.Question{ID: id, Kind: answers.KindChoice, Label: "Start date month", Required: required, Options: monthList}
	}
	text := func(id string) answers.Question {
		return answers.Question{ID: id, Kind: answers.KindText, Label: "Date", Required: true}
	}
	req := sampleRequest(
		answers.Question{ID: "company-name-0", Kind: answers.KindText, Label: "Company name", Required: true},
		answers.Question{ID: "title-0", Kind: answers.KindText, Label: "Title", Required: true},
		month("start-date-month-0", true), text("start-date-year-0"),
		month("end-date-month-0", true), text("end-date-year-0"),
		answers.Question{ID: "current-role-0_1", Kind: answers.KindCheckbox, Label: "Current role"},
		answers.Question{ID: "company-name-1", Kind: answers.KindText, Label: "Company name", Required: true},
		month("start-date-month-1", true), text("start-date-year-1"),
		month("end-date-month-1", true), text("end-date-year-1"),
		answers.Question{ID: "current-role-1_1", Kind: answers.KindCheckbox, Label: "Current role"},
		month("start-date-month-2", true), text("start-date-year-2"),
		month("start-month--0", false), text("start-year--0"), text("end-year--0"),
		month("start-month--1", false), text("start-year--1"),
		month("end-month--1", true),
	)
	req.Resume = json.RawMessage(historyResume)
	req.Info.Facts = []answers.Fact{{Question: "End month at Northeastern University", Answer: "June"}}
	got := ask(t, address, goodKey, req)
	values := valuesOf(got.Reply)
	want := map[string]string{
		"company-name-0": "Northwind", "title-0": "Senior Engineer", "start-date-month-0": "May", "start-date-year-0": "2021", "current-role-0_1": "yes",
		"company-name-1": "Contoso", "start-date-month-1": "June", "start-date-year-1": "2017", "end-date-month-1": "April", "end-date-year-1": "2021",
		"start-date-year-2": "2015",
		"start-year--0":     "2013", "end-year--0": "2017",
		"start-month--1": "September", "start-year--1": "2018", "end-month--1": "June",
	}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	for _, id := range []string{"end-date-month-0", "end-date-year-0", "current-role-1_1", "start-month--0"} {
		if _, ok := values[id]; ok {
			t.Errorf("%s should stay empty: %v", id, values[id])
		}
	}
	why := whyOf(got.Reply)
	if why["start-date-month-2"] == "" {
		t.Errorf("a required month the résumé does not hold goes to the member: %+v", got.Reply.Asks)
	}
	for _, one := range got.Reply.Asks {
		if one.ID == "start-date-month-2" && one.Label != "Start month at Fabrikam" {
			t.Errorf("the member should be told which job it is: %q", one.Label)
		}
	}
	if why["start-month--0"] != "" {
		t.Error("an optional month with nothing saved is simply left")
	}
}

func TestHistory_TheMemberSavesASchoolsMonthOnce(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "", 500 })
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "start-month--0", Kind: answers.KindChoice, Label: "Start date month", Options: []string{"Jan", "Sep"}})
	req.Resume = json.RawMessage(historyResume)
	req.Info.Facts = []answers.Fact{{Question: "Start month at Boston University", Answer: "September"}}
	values := valuesOf(ask(t, address, goodKey, req).Reply)
	if len(values["start-month--0"]) != 1 || values["start-month--0"][0] != "Sep" {
		t.Errorf("it should match the form's own short wording: %v", values)
	}
}

func TestParseDate(t *testing.T) {
	cases := map[string][3]string{
		"May 2021":       {"May", "2021", ""},
		"September 2017": {"September", "2017", ""},
		"Sept. 2017":     {"September", "2017", ""},
		"05/2021":        {"May", "2021", ""},
		"2021-11":        {"November", "2021", ""},
		"2013":           {"", "2013", ""},
		"Present":        {"", "", "current"},
		"current":        {"", "", "current"},
		"":               {"", "", ""},
	}
	for text, want := range cases {
		month, year, current := parseDate(text)
		isCurrent := ""
		if current {
			isCurrent = "current"
		}
		if month != want[0] || year != want[1] || isCurrent != want[2] {
			t.Errorf("parseDate(%q) = %q, %q, %v", text, month, year, current)
		}
	}
}

func TestAddress_IsCopiedOnly(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindText, Label: "Mailing Address", Required: true}, answers.Question{ID: "b", Kind: answers.KindText, Label: "Street address", Required: true})
	req.Info.Address = "1 Main St"
	values := valuesOf(ask(t, address, goodKey, req).Reply)
	if values["a"][0] != "1 Main St" || values["b"][0] != "1 Main St" {
		t.Errorf("values = %v", values)
	}
}

func TestDemographics_AreDeclinedAndNeverGuessed(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should never be asked about these")
		return "", 500
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "g", Kind: answers.KindChoice, Label: "Gender", Required: true, Options: []string{"Male", "Female", "Decline To Self Identify"}},
		answers.Question{ID: "r", Kind: answers.KindChoice, Label: "Race and Ethnicity", Required: true, Options: []string{"Asian", "I don't wish to answer"}},
		answers.Question{ID: "v", Kind: answers.KindChoice, Label: "Veteran Status", Required: true, Options: []string{"I am a veteran", "I am not a veteran"}},
		answers.Question{ID: "l", Kind: answers.KindChoice, Label: "I consider myself a member of the LGBTQ+ community. (optional)", Options: []string{"Yes", "No"}},
	))
	values := valuesOf(got.Reply)
	if values["g"][0] != "Decline To Self Identify" || values["r"][0] != "I don't wish to answer" {
		t.Errorf("values = %v", values)
	}
	why := whyOf(got.Reply)
	if !strings.Contains(why["v"], "yours to answer") {
		t.Errorf("a required question with no way to decline goes to the member: %q", why["v"])
	}
	if _, ok := values["l"]; ok {
		t.Error("an optional one with no way to decline stays empty")
	}
}

func TestDemographics_UseWhatTheMemberSaved(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“Fine.”", 200 })
	address, _ := start(t, f)
	decline := "I don't wish to answer"
	req := sampleRequest(
		answers.Question{ID: "g", Kind: answers.KindChoice, Label: "Gender", Required: true, Options: []string{"Male", "Female", decline}},
		answers.Question{ID: "g2", Kind: answers.KindChoice, Label: "Gender Identity (optional)", Options: []string{"Man", "Woman", "Non-binary", decline}},
		answers.Question{ID: "r", Kind: answers.KindChoice, Label: "Race and Ethnicity", Required: true, Options: []string{"Asian", "White (Not Hispanic or Latino)", "Two or more races", decline}},
		answers.Question{ID: "r2", Kind: answers.KindMultiChoice, Label: "Race or Ethnicity (optional)", Options: []string{"Black", "White", decline}},
		answers.Question{ID: "v", Kind: answers.KindChoice, Label: "Veteran Status", Required: true, Options: []string{"I am a protected veteran", "I am not a protected veteran", decline}},
		answers.Question{ID: "v2", Kind: answers.KindChoice, Label: "Have you served in the military?", Options: []string{"Yes", "No", decline}},
		answers.Question{ID: "d", Kind: answers.KindChoice, Label: "Disability Status", Required: true, Options: []string{"Yes, I have a disability", "No, I do not have a disability and have not had one in the past", decline}},
		answers.Question{ID: "l", Kind: answers.KindChoice, Label: "Do you identify as part of the LGBTQ+ community?", Options: []string{"Yes", "No", decline}},
		answers.Question{ID: "h", Kind: answers.KindChoice, Label: "Are you Hispanic or Latino?", Required: true, Options: []string{"Yes", "No", decline}},
		answers.Question{ID: "t", Kind: answers.KindChoice, Label: "Do you identify as transgender?", Options: []string{"Yes", "No", decline}},
		answers.Question{ID: "w", Kind: answers.KindLongText, Label: "Why this job?", Required: true},
	)
	req.Info.Facts = []answers.Fact{
		{Question: "Gender", Answer: "Female"}, {Question: "Race", Answer: "White"},
		{Question: "Veteran status", Answer: "I am not a veteran"}, {Question: "Disability status", Answer: "No"}, {Question: "LGBTQ+", Answer: "No"},
	}
	got := ask(t, address, goodKey, req)
	want := map[string]string{
		"g": "Female", "g2": "Woman", "r": "White (Not Hispanic or Latino)", "r2": "White",
		"v": "I am not a protected veteran", "v2": "No",
		"d": "No, I do not have a disability and have not had one in the past", "l": "No",
		"h": decline, "t": "No",
	}
	values := valuesOf(got.Reply)
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	asked := f.requests()
	if len(asked) != 1 {
		t.Fatalf("only the written question goes to the model: asked %d times", len(asked))
	}
	for _, word := range []string{"Female", "Veteran status", "LGBTQ"} {
		if strings.Contains(asked[0].Messages[1].Content, word) {
			t.Errorf("the model was sent %q", word)
		}
	}
}

func TestDemographics_HispanicOrLatinoIsItsOwnAnswer(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "", 500 })
	address, _ := start(t, f)
	decline := "Decline To Self Identify"
	questions := []answers.Question{
		{ID: "yes_no", Kind: answers.KindChoice, Label: "Are you Hispanic/Latino?", Required: true, Options: []string{"Yes", "No", decline}},
		{ID: "worded", Kind: answers.KindChoice, Label: "Do you identify as Hispanic or Latino?", Options: []string{"I am Hispanic or Latino", "I am not Hispanic or Latino", decline}},
		{ID: "list", Kind: answers.KindChoice, Label: "Ethnicity", Options: []string{"Hispanic or Latino", "Not Hispanic or Latino", decline}},
		{ID: "race", Kind: answers.KindChoice, Label: "Race", Options: []string{"Asian", "White", "Hispanic or Latino", decline}},
	}
	req := sampleRequest(questions...)
	req.Info.Facts = []answers.Fact{{Question: "Hispanic or Latino", Answer: "No"}, {Question: "Race", Answer: "White"}}
	got := ask(t, address, goodKey, req)
	values := valuesOf(got.Reply)
	want := map[string]string{"yes_no": "No", "worded": "I am not Hispanic or Latino", "list": "Not Hispanic or Latino", "race": "White"}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}

	req.Info.Facts = []answers.Fact{{Question: "Hispanic or Latino", Answer: "Yes"}}
	values = valuesOf(ask(t, address, goodKey, req).Reply)
	want = map[string]string{"yes_no": "Yes", "worded": "I am Hispanic or Latino", "list": "Hispanic or Latino"}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("saved yes, %s = %v, want %q", id, values[id], value)
		}
	}

	req.Info.Facts = nil
	values = valuesOf(ask(t, address, goodKey, req).Reply)
	for _, id := range []string{"yes_no", "worded", "list", "race"} {
		if len(values[id]) != 1 || values[id][0] != decline {
			t.Errorf("nothing saved, %s = %v, want it declined", id, values[id])
		}
	}
}

func TestDemographics_NothingSavedAndNoClearMatchAreDeclined(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "", 500 })
	address, _ := start(t, f)
	decline := "Decline to self identify"
	req := sampleRequest(
		answers.Question{ID: "g", Kind: answers.KindChoice, Label: "Gender", Required: true, Options: []string{"Male", "Female", decline}},
		answers.Question{ID: "r", Kind: answers.KindChoice, Label: "Race", Required: true, Options: []string{"Asian", "Black", decline}},
	)
	req.Info.Facts = []answers.Fact{{Question: "Race", Answer: "White"}}
	got := ask(t, address, goodKey, req)
	values := valuesOf(got.Reply)
	if values["g"][0] != decline || values["r"][0] != decline {
		t.Errorf("values = %v", values)
	}
}

func TestStatements_AreTickedOnlyWhenTheMemberSaidSo(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should never be asked about these")
		return "", 500
	})
	address, _ := start(t, f)
	req := sampleRequest(
		answers.Question{ID: "box", Kind: answers.KindCheckbox, Label: "I affirm that what I submit is my own work.", Required: true},
		answers.Question{ID: "drop", Kind: answers.KindChoice, Label: "By selecting below, I accept the privacy policy.", Required: true, Options: []string{"I do not agree", "I agree"}},
		answers.Question{ID: "no_way", Kind: answers.KindChoice, Label: "By clicking below, you acknowledge the policy.", Required: true, Options: []string{"Maybe later"}},
		answers.Question{ID: "typed", Kind: answers.KindText, Label: "By typing your name, I confirm this is true.", Required: true},
		answers.Question{ID: "news", Kind: answers.KindCheckbox, Label: "Send me news by text message"},
	)
	req.Info.AgreeForMe = "yes"
	got := ask(t, address, goodKey, req)
	values := valuesOf(got.Reply)
	if len(values["box"]) != 1 || values["box"][0] != "yes" {
		t.Errorf("box = %v", values["box"])
	}
	if len(values["drop"]) != 1 || values["drop"][0] != "I agree" {
		t.Errorf("it should take the option that agrees: %v", values["drop"])
	}
	why := whyOf(got.Reply)
	for _, id := range []string{"no_way", "typed"} {
		if why[id] == "" {
			t.Errorf("%s has nothing to tick, so it goes to the member", id)
		}
	}
	if _, ok := values["news"]; ok {
		t.Error("an optional box stays empty")
	}
}

func TestStatements_AreNeverAgreedToForTheMember(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should never be asked about these")
		return "", 500
	})
	address, _ := start(t, f)
	label := "I affirm that what I submit will reflect my own work."
	req := sampleRequest(
		answers.Question{ID: "box", Kind: answers.KindCheckbox, Label: label, Required: true},
		answers.Question{ID: "drop", Kind: answers.KindChoice, Label: "By clicking below, you acknowledge the privacy policy.", Required: true, Options: []string{"Acknowledge"}},
		answers.Question{ID: "news", Kind: answers.KindCheckbox, Label: "Send me news"},
	)
	got := ask(t, address, goodKey, req)
	why := whyOf(got.Reply)
	for _, id := range []string{"box", "drop"} {
		if !strings.Contains(why[id], "statement you make yourself") {
			t.Errorf("%s: %q", id, why[id])
		}
	}
	if len(got.Reply.Answers) != 0 {
		t.Errorf("answers = %+v", got.Reply.Answers)
	}
	if _, ok := why["news"]; ok {
		t.Error("an optional box is simply left")
	}

	// Once the member has said yes to this very wording, it is their answer.
	req.Info.Facts = append(req.Info.Facts, answers.Fact{Question: label, Answer: "yes"})
	got = ask(t, address, goodKey, req)
	if values := valuesOf(got.Reply)["box"]; len(values) != 1 || values[0] != "yes" {
		t.Errorf("box = %v", values)
	}
}

func TestLegalQuestions_NeedTheMembersOwnAnswerFirst(t *testing.T) {
	f := newFakeOllama(t, func(req chatRequest) (string, int) { return `{"answer":"Yes"}`, 200 })
	address, _ := start(t, f)
	yesNo := []string{"Yes", "No"}
	questions := []answers.Question{
		{ID: "auth", Kind: answers.KindChoice, Label: "Are you legally authorized to work in the country in which you are applying?", Required: true, Options: yesNo},
		{ID: "visa", Kind: answers.KindChoice, Label: "Will you now or in the future require sponsorship for employment visa status?", Required: true, Options: yesNo},
		{ID: "citizen", Kind: answers.KindChoice, Label: "Are you a US citizen?", Required: true, Options: yesNo},
		{ID: "clear", Kind: answers.KindChoice, Label: "Do you hold an active security clearance?", Required: true, Options: yesNo},
		{ID: "crime", Kind: answers.KindChoice, Label: "Have you ever been convicted of a felony?", Required: true, Options: yesNo},
		{ID: "quiet", Kind: answers.KindChoice, Label: "Are you eligible to work in Canada?", Options: yesNo},
	}
	req := sampleRequest(questions...)
	req.Info.Facts = nil
	got := ask(t, address, goodKey, req)
	if asked := f.requests(); len(asked) != 0 {
		t.Fatalf("with nothing saved, the model should not be asked: %d times", len(asked))
	}
	why := whyOf(got.Reply)
	for _, id := range []string{"auth", "visa", "citizen", "clear", "crime"} {
		if !strings.Contains(why[id], "Only you can answer") {
			t.Errorf("%s: %q", id, why[id])
		}
	}
	if _, ok := why["quiet"]; ok {
		t.Error("an optional one is simply left")
	}
	for _, one := range got.Reply.Asks {
		if one.Kind != answers.KindChoice || len(one.Options) != 2 {
			t.Errorf("the member should get the form's choices: %+v", one)
		}
	}

	req.Info.Facts = []answers.Fact{
		{Question: "Work authorization", Answer: "Authorized to work in the US."},
		{Question: "Visa sponsorship", Answer: "I do not need sponsorship."},
		{Question: "Citizenship", Answer: "US citizen."},
		{Question: "Security clearance", Answer: "None."},
		{Question: "Criminal record", Answer: "No convictions."},
	}
	got = ask(t, address, goodKey, req)
	if asked := f.requests(); len(asked) != len(questions) {
		t.Errorf("with answers saved, the model writes them: asked %d times", len(asked))
	}
	if len(got.Reply.Asks) != 0 {
		t.Errorf("asks = %+v", got.Reply.Asks)
	}
}

func TestModel_GetsMoreAboutTheirCareer(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“Fine.”", 200 })
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Tell us about a project.", Required: true})
	req.Info.Career = "I also built a ledger at a startup."
	ask(t, address, goodKey, req)
	asked := f.requests()
	if len(asked) != 1 || !strings.Contains(asked[0].Messages[1].Content, "I also built a ledger at a startup.") {
		t.Errorf("the model should get what the member wrote: %+v", asked)
	}
}

func TestChoice_MustBeOneTheFormOffers(t *testing.T) {
	replies := map[string]string{
		"Choice one":   `{"answer":"Yes"}`,
		"Made up":      `{"answer":"Probably"}`,
		"Not settled":  `{"answer":"NEED_CLARIFICATION"}`,
		"Broken reply": `not json`,
		"Several":      `{"answer":["Red","Blue"]}`,
		"Mixed list":   `{"answer":["Red","Purple"]}`,
	}
	f := newFakeOllama(t, func(req chatRequest) (string, int) {
		for label, reply := range replies {
			if strings.Contains(req.Messages[1].Content, label) {
				return reply, 200
			}
		}
		return "", 500
	})
	address, _ := start(t, f)
	yesNo := []string{"Yes", "No"}
	colours := []string{"Red", "Blue"}
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "Choice one", Required: true, Options: yesNo},
		answers.Question{ID: "b", Kind: answers.KindChoice, Label: "Made up", Required: true, Options: yesNo},
		answers.Question{ID: "c", Kind: answers.KindChoice, Label: "Not settled", Required: true, Options: yesNo},
		answers.Question{ID: "d", Kind: answers.KindChoice, Label: "Broken reply", Required: true, Options: yesNo},
		answers.Question{ID: "e", Kind: answers.KindMultiChoice, Label: "Several", Required: true, Options: colours},
		answers.Question{ID: "f", Kind: answers.KindMultiChoice, Label: "Mixed list", Required: true, Options: colours},
		answers.Question{ID: "g", Kind: answers.KindChoice, Label: "Not settled again", Options: yesNo},
	))
	values := valuesOf(got.Reply)
	if values["a"][0] != "Yes" || len(values["e"]) != 2 {
		t.Errorf("values = %v", values)
	}
	why := whyOf(got.Reply)
	for _, id := range []string{"b", "c", "d", "f"} {
		if why[id] == "" {
			t.Errorf("%s should go to the member", id)
		}
		if _, ok := values[id]; ok {
			t.Errorf("%s should have no answer: %v", id, values[id])
		}
	}
	if _, ok := why["g"]; ok {
		t.Error("an optional question with no answer is simply left")
	}
	for _, request := range f.requests() {
		if request.Format == nil {
			t.Error("a choice's reply must be held to its options")
		}
	}
}

func TestTheNoAnswerMarker_NeverReachesAForm(t *testing.T) {
	spellings := []string{"NEED_CLARIFICATION", "Need_clarification", "need clarification", "NEED-CLARIFICATION", "Need clarification."}
	for _, spelling := range spellings {
		f := newFakeOllama(t, func(req chatRequest) (string, int) {
			if req.Format == nil {
				return "**Suggested Answer:**\n“" + spelling + "”", 200
			}
			packed, _ := json.Marshal(map[string]string{"answer": spelling})
			return string(packed), 200
		})
		address, _ := start(t, f)
		got := ask(t, address, goodKey, sampleRequest(
			answers.Question{ID: "optional", Kind: answers.KindText, Label: "Anything else you'd like to share?"},
			answers.Question{ID: "required", Kind: answers.KindText, Label: "Your favorite tool?", Required: true},
			answers.Question{ID: "written", Kind: answers.KindLongText, Label: "Tell us more", Required: true},
		))
		values := valuesOf(got.Reply)
		for _, id := range []string{"optional", "required", "written"} {
			if len(values[id]) != 0 {
				t.Errorf("%q: %s was filled with %v", spelling, id, values[id])
			}
		}
		why := whyOf(got.Reply)
		if why["required"] == "" || why["written"] == "" {
			t.Errorf("%q: required ones go to the member: %v", spelling, why)
		}
		if _, ok := why["optional"]; ok {
			t.Errorf("%q: an optional one is simply left", spelling)
		}
	}
}

func TestHowDidYouHear_IsLinkedIn(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return `{"answer":"Company Website"}`, 200 })
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "typed", Kind: answers.KindText, Label: "How did you hear about this opportunity at Grafana?", Required: true},
		answers.Question{ID: "list", Kind: answers.KindChoice, Label: "How did you hear about this opportunity at Grafana?", Options: []string{"Company Website", "Grafana Event", "Grot Community", "LinkedIn", "Referral", "Other"}},
		answers.Question{ID: "boxes", Kind: answers.KindMultiChoice, Label: "How did you hear about Twilio?", Required: true, Options: []string{"Careers Website", "Linked In", "Other"}},
		answers.Question{ID: "site", Kind: answers.KindChoice, Label: "Where did you find this job?", Options: []string{"Friend", "Job Board", "Other"}},
		answers.Question{ID: "neither", Kind: answers.KindChoice, Label: "How did you hear about us?", Options: []string{"Company Website", "Friend", "Other"}},
	))
	values := valuesOf(got.Reply)
	want := map[string]string{"typed": "LinkedIn", "list": "LinkedIn", "boxes": "Linked In", "site": "Job Board", "neither": "Company Website"}
	for id, value := range want {
		if len(values[id]) != 1 || values[id][0] != value {
			t.Errorf("%s = %v, want %q", id, values[id], value)
		}
	}
	if asked := f.requests(); len(asked) != 1 {
		t.Errorf("only the one with no such choice goes to the model: %d times", len(asked))
	}
}

func TestNeutralChoices_AreNotOfferedToTheModel(t *testing.T) {
	f := newFakeOllama(t, func(req chatRequest) (string, int) { return `{"answer":"Often"}`, 200 })
	address, _ := start(t, f)
	ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "How often do you code?", Required: true, Options: []string{"Often", "Rarely", "Other", "Prefer not to say", "N/A", "Not sure", "Neutral"}},
	))
	asked := f.requests()
	if len(asked) != 1 {
		t.Fatalf("asked %d times", len(asked))
	}
	packed, _ := json.Marshal(asked[0].Format)
	message := asked[0].Messages[1].Content
	for _, gone := range []string{"Other", "Prefer not to say", "N/A", "Not sure", "Neutral"} {
		if strings.Contains(string(packed), gone) {
			t.Errorf("%q is still allowed in the reply: %s", gone, packed)
		}
		if strings.Contains(message[strings.LastIndex(message, "only accepts"):], gone) {
			t.Errorf("%q is still offered", gone)
		}
	}
	if !strings.Contains(string(packed), "Often") || !strings.Contains(string(packed), "Rarely") {
		t.Errorf("the real choices should stay: %s", packed)
	}
}

func TestNeutralChoices_MemberStillSeesThemAndAllNeutralStays(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return `{"answer":"NEED_CLARIFICATION"}`, 200 })
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "Pick one", Required: true, Options: []string{"Red", "Other"}},
	))
	if len(got.Reply.Asks) != 1 || len(got.Reply.Asks[0].Options) != 2 {
		t.Errorf("the member sees all of the form's choices: %+v", got.Reply.Asks)
	}
	if kept := definiteOptions([]string{"Other", "N/A"}); len(kept) != 2 {
		t.Errorf("with nothing else to offer they stay: %v", kept)
	}
	if kept := definiteOptions([]string{"None", "Other side of town", "Yes"}); len(kept) != 2 {
		t.Errorf("only a choice that says nothing goes: %v", kept)
	}
}

func TestAFormCheckingForAPerson_IsLeftForTheMember(t *testing.T) {
	stops := []answers.Question{
		{ID: "a", Kind: answers.KindChoice, Label: "Which of the following best describes you?", Required: true, Options: []string{"I am a human being", "I am an AI agent"}},
		{ID: "b", Kind: answers.KindChoice, Label: "Are you a robot?", Options: []string{"Yes", "No"}},
		{ID: "c", Kind: answers.KindText, Label: "Please confirm you are a real person", Required: true},
		{ID: "d", Kind: answers.KindMultiChoice, Label: "Select one", Options: []string{"I'm not a robot"}},
	}
	for _, question := range stops {
		f := newFakeOllama(t, func(chatRequest) (string, int) {
			t.Error("the model should not be asked anything")
			return "", 500
		})
		address, _ := start(t, f)
		req := sampleRequest(answers.Question{ID: "email", Kind: answers.KindText, Label: "Email", Required: true}, question)
		// Having said something about it before does not get a form past this.
		req.Info.Facts = []answers.Fact{{Question: question.Label, Answer: "I am a human being"}}
		got := ask(t, address, goodKey, req)
		if !strings.Contains(got.Reply.Stop, "checks whether a person") {
			t.Errorf("%q: stop = %q", question.Label, got.Reply.Stop)
		}
		if len(got.Reply.Answers) != 0 {
			t.Errorf("%q: answers = %+v", question.Label, got.Reply.Answers)
		}
	}
}

func TestOrdinaryQuestionsAboutBots_AreNotMistakenForACheck(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return `{"answer":"Yes"}`, 200 })
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindChoice, Label: "Have you built chat bots or AI agents?", Required: true, Options: []string{"Yes", "No"}},
		answers.Question{ID: "b", Kind: answers.KindChoice, Label: "Are you working on robotics now?", Options: []string{"Yes", "No"}},
		answers.Question{ID: "c", Kind: answers.KindChoice, Label: "Are you familiar with human resources systems?", Options: []string{"Yes", "No"}},
	))
	if got.Reply.Stop != "" {
		t.Errorf("stop = %q", got.Reply.Stop)
	}
	if len(got.Reply.Answers) != 3 {
		t.Errorf("answers = %+v", got.Reply.Answers)
	}
}

func TestOneLine_GetsAValueOrNothing(t *testing.T) {
	f := newFakeOllama(t, func(req chatRequest) (string, int) {
		switch {
		case strings.Contains(req.Messages[1].Content, "employer"):
			return `{"answer":"Acme"}`, 200
		case strings.Contains(req.Messages[1].Content, "salary"):
			return `{"answer":"NEED_CLARIFICATION"}`, 200
		}
		return `{"answer":"[your city]"}`, 200
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindText, Label: "Current employer", Required: true},
		answers.Question{ID: "b", Kind: answers.KindText, Label: "Expected salary", Required: true},
		answers.Question{ID: "c", Kind: answers.KindText, Label: "Nearest office", Required: true},
	))
	values := valuesOf(got.Reply)
	if values["a"][0] != "Acme" {
		t.Errorf("values = %v", values)
	}
	why := whyOf(got.Reply)
	if why["b"] == "" || why["c"] == "" {
		t.Errorf("an unknown or a blank goes to the member: %v", why)
	}
}

func TestWritten_WithNoSuggestedAnswerGoesToTheMember(t *testing.T) {
	f := newFakeOllama(t, func(req chatRequest) (string, int) {
		switch {
		case strings.Contains(req.Messages[1].Content, "Short ask"):
			return "How many years did you work with Kafka?", 200
		case strings.Contains(req.Messages[1].Content, "Long brief"):
			return "Preparation brief: " + strings.Repeat("target role and evaluation themes. ", 40), 200
		case strings.Contains(req.Messages[1].Content, "With blank"):
			return "**Suggested Answer:**\n“I worked at [company] for years.”", 200
		case strings.Contains(req.Messages[1].Content, "Thinks first"):
			return "<think>hmm</think>\n**Suggested Answer:**\n“Done carefully.”", 200
		}
		return "**Suggested Answer:** \"Plain quotes.\"", 200
	})
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Short ask", Required: true},
		answers.Question{ID: "b", Kind: answers.KindLongText, Label: "Long brief", Required: true},
		answers.Question{ID: "c", Kind: answers.KindLongText, Label: "With blank", Required: true},
		answers.Question{ID: "d", Kind: answers.KindLongText, Label: "Thinks first", Required: true},
		answers.Question{ID: "e", Kind: answers.KindLongText, Label: "Plain one", Required: true},
		answers.Question{ID: "f", Kind: answers.KindLongText, Label: "Short ask, optional"},
	))
	why := whyOf(got.Reply)
	if why["a"] != "How many years did you work with Kafka?" {
		t.Errorf("the model's own short question should reach the member: %q", why["a"])
	}
	if !strings.Contains(why["b"], "do not say") || !strings.Contains(why["c"], "do not say") {
		t.Errorf("why = %v", why)
	}
	values := valuesOf(got.Reply)
	if values["d"][0] != "Done carefully." || values["e"][0] != "Plain quotes." {
		t.Errorf("values = %v", values)
	}
	if _, ok := values["f"]; ok {
		t.Error("an optional question the model cannot answer is simply left")
	}
}

func TestModelFailing_FailsTheRequestRatherThanAskingTheMember(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "", 500 })
	address, _ := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true}))
	if got.State != answers.StateFailed || got.Reply != nil || got.Error == "" {
		t.Errorf("got %+v", got)
	}
}

func TestKeys(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“Fine.”", 200 })
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true})

	cases := map[string]int{
		"": http.StatusUnauthorized,
		"kapp_not_a_key_kiasa_knows_about_at_all": http.StatusUnauthorized,
		"kapp_kiasa_is_unreachable_right_now_key": http.StatusServiceUnavailable,
		goodKey: http.StatusAccepted,
	}
	for key, want := range cases {
		res, body := call(t, http.MethodPost, address+"/v1/answers", key, req)
		if res.StatusCode != want {
			t.Errorf("key %q: status %d, want %d: %s", key, res.StatusCode, want, body)
		}
	}
	if len(f.requests()) > 1 {
		t.Error("only the accepted key should reach the model")
	}
}

func TestSomeoneElsesRequest_LooksLikeNoRequest(t *testing.T) {
	release := make(chan struct{})
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		<-release
		return "**Suggested Answer:**\n“Private.”", 200
	})
	defer close(release)
	address, _ := start(t, f)
	res, body := call(t, http.MethodPost, address+"/v1/answers", goodKey, sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true}))
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("status %d", res.StatusCode)
	}
	var got answers.Progress
	json.Unmarshal(body, &got)
	other := "kapp_member_two_key_that_is_long_enough"
	if res, _ := call(t, http.MethodGet, address+"/v1/answers/"+got.Ticket, other, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("another member read it: status %d", res.StatusCode)
	}
	call(t, http.MethodDelete, address+"/v1/answers/"+got.Ticket, other, nil)
	if res, _ := call(t, http.MethodGet, address+"/v1/answers/"+got.Ticket, goodKey, nil); res.StatusCode != http.StatusOK {
		t.Errorf("another member removed it: status %d", res.StatusCode)
	}
}

func TestQueue_RunsOneAtATimeAndSaysWhoIsAhead(t *testing.T) {
	release := make(chan struct{})
	var mu sync.Mutex
	running, most := 0, 0
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		mu.Lock()
		running++
		if running > most {
			most = running
		}
		mu.Unlock()
		<-release
		mu.Lock()
		running--
		mu.Unlock()
		return "**Suggested Answer:**\n“Fine.”", 200
	})
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true})

	_, first := call(t, http.MethodPost, address+"/v1/answers", goodKey, req)
	var one answers.Progress
	json.Unmarshal(first, &one)
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, body := call(t, http.MethodGet, address+"/v1/answers/"+one.Ticket, goodKey, nil)
		var now answers.Progress
		json.Unmarshal(body, &now)
		if now.State == answers.StateWorking {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the first request never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	other := "kapp_member_two_key_that_is_long_enough"
	_, second := call(t, http.MethodPost, address+"/v1/answers", other, req)
	var two answers.Progress
	json.Unmarshal(second, &two)
	if two.State != answers.StateQueued || two.Position != 0 {
		t.Errorf("second = %+v", two)
	}
	close(release)
	for time.Now().Before(deadline) {
		_, body := call(t, http.MethodGet, address+"/v1/answers/"+two.Ticket, other, nil)
		var now answers.Progress
		json.Unmarshal(body, &now)
		if now.State == answers.StateDone {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if most != 1 {
		t.Errorf("%d ran at once", most)
	}
}

func TestANewRequest_ReplacesTheMembersOldOne(t *testing.T) {
	release := make(chan struct{})
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		<-release
		return "**Suggested Answer:**\n“Fine.”", 200
	})
	defer close(release)
	address, _ := start(t, f)
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true})
	_, first := call(t, http.MethodPost, address+"/v1/answers", goodKey, req)
	var one answers.Progress
	json.Unmarshal(first, &one)
	res, _ := call(t, http.MethodPost, address+"/v1/answers", goodKey, req)
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("status %d", res.StatusCode)
	}
	if res, _ := call(t, http.MethodGet, address+"/v1/answers/"+one.Ticket, goodKey, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("the old request should be gone: status %d", res.StatusCode)
	}
}

func TestBadRequests_AreRefused(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("the model should not be asked")
		return "", 500
	})
	address, _ := start(t, f)
	many := make([]answers.Question, questionsLimit+1)
	for i := range many {
		many[i] = answers.Question{ID: "q", Kind: answers.KindText, Label: "Q"}
	}
	noResume := sampleRequest(answers.Question{ID: "a", Kind: answers.KindText, Label: "Q"})
	noResume.Resume = nil
	huge := sampleRequest(answers.Question{ID: "a", Kind: answers.KindText, Label: "Q"})
	huge.Job.Description = strings.Repeat("x", bodyLimit+1)
	for name, req := range map[string]answers.Request{
		"no questions": sampleRequest(),
		"too many":     sampleRequest(many...),
		"no résumé":    noResume,
		"no id":        sampleRequest(answers.Question{Kind: answers.KindText, Label: "Q"}),
		"no label":     sampleRequest(answers.Question{ID: "a", Kind: answers.KindText}),
		"far too big":  huge,
	} {
		if res, body := call(t, http.MethodPost, address+"/v1/answers", goodKey, req); res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d: %s", name, res.StatusCode, body)
		}
	}
}

func TestNothingSent_ReachesTheLogOrStaysAfterwards(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	defer log.SetOutput(os.Stderr)
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“A private answer.”", 200 })
	address, s := start(t, f)
	got := ask(t, address, goodKey, sampleRequest(
		answers.Question{ID: "email", Kind: answers.KindText, Label: "Email", Required: true},
		answers.Question{ID: "q", Kind: answers.KindLongText, Label: "A private question", Required: true},
	))
	for _, secret := range []string{"ana@example.com", "A private question", "A private answer", "billing", "Acme"} {
		if strings.Contains(logged.String(), secret) {
			t.Errorf("the log holds %q", secret)
		}
	}
	s.mu.Lock()
	if s.tickets[got.Ticket].req != nil {
		t.Error("what was sent should be dropped once answered")
	}
	s.mu.Unlock()

	s.sweep(time.Now().Add(keepAnswerFor + time.Second))
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.tickets) != 0 {
		t.Error("answers should be forgotten after a short while")
	}
}

func TestAbandonedRequest_IsDropped(t *testing.T) {
	release := make(chan struct{})
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		<-release
		return "**Suggested Answer:**\n“Fine.”", 200
	})
	defer close(release)
	address, s := start(t, f)
	call(t, http.MethodPost, address+"/v1/answers", goodKey, sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true}))
	s.sweep(time.Now().Add(abandonAfter + time.Second))
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.tickets) != 0 {
		t.Error("a request no browser is waiting for should be dropped")
	}
}

func connectedIDs(s *Server) map[string]Connected {
	out := map[string]Connected{}
	for _, one := range s.ConnectedNow() {
		out[one.Member] = one
	}
	return out
}

func TestPing_ShowsWhoIsConnected(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "**Suggested Answer:**\n“Fine.”", 200 })
	address, s := start(t, f)
	if len(s.ConnectedNow()) != 0 {
		t.Error("no one is connected to begin with")
	}
	if res, _ := call(t, http.MethodGet, address+"/v1/ping", "kapp_not_a_key_kiasa_knows_about_at_all", nil); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("an unknown key: status %d", res.StatusCode)
	}
	if res, _ := call(t, http.MethodGet, address+"/v1/ping", "", nil); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("no key: status %d", res.StatusCode)
	}
	if len(s.ConnectedNow()) != 0 {
		t.Error("a browser KIASA does not know never counts as connected")
	}
	if res, _ := call(t, http.MethodGet, address+"/v1/ping", goodKey, nil); res.StatusCode != http.StatusOK {
		t.Errorf("a known key: status %d", res.StatusCode)
	}
	call(t, http.MethodGet, address+"/v1/ping", goodKey, nil) // Known already, so no need to ask KIASA.
	call(t, http.MethodGet, address+"/v1/ping", "kapp_member_two_key_that_is_long_enough", nil)
	found := connectedIDs(s)
	if len(found) != 2 || found["member-1"].Member == "" || found["member-2"].Member == "" {
		t.Fatalf("connected = %+v", found)
	}

	ask(t, address, goodKey, sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true}))
	found = connectedIDs(s)
	if found["member-1"].Requests != 1 || found["member-2"].Requests != 0 {
		t.Errorf("each member's own count: %+v", found)
	}

	// Silent for too long, they no longer count.
	s.mu.Lock()
	s.seen["member-2"].last = time.Now().Add(-connectedFor - time.Second)
	s.mu.Unlock()
	found = connectedIDs(s)
	if _, ok := found["member-2"]; ok || len(found) != 1 {
		t.Errorf("connected = %+v", found)
	}
}

func TestPing_DoesNotAskTheModel(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		t.Error("a ping should not use the model")
		return "", 500
	})
	address, _ := start(t, f)
	call(t, http.MethodGet, address+"/v1/ping", goodKey, nil)
}

func TestHealthNow_SaysHowTheModelIs(t *testing.T) {
	fine := true
	f := newFakeOllama(t, func(chatRequest) (string, int) {
		if fine {
			return "**Suggested Answer:**\n“Fine.”", 200
		}
		return "", 500
	})
	address, s := start(t, f)
	health := s.HealthNow(context.Background())
	if !health.Ollama || !health.Installed || !health.Loaded || health.OnGPU != 75 || health.Model != "test-model" {
		t.Errorf("health = %+v", health)
	}
	if health.Answered != 0 || health.LastAnswerSecondsAgo != nil || health.LastFailureSecondsAgo != nil {
		t.Errorf("nothing has happened yet: %+v", health)
	}
	req := sampleRequest(answers.Question{ID: "a", Kind: answers.KindLongText, Label: "Why?", Required: true})
	ask(t, address, goodKey, req)
	fine = false
	ask(t, address, goodKey, req)
	health = s.HealthNow(context.Background())
	if health.Answered != 1 || health.Failed != 1 || health.LastAnswerSecondsAgo == nil || health.LastFailureSecondsAgo == nil {
		t.Errorf("health = %+v", health)
	}

	s.cfg.Model.Name = "not-installed"
	if health := s.HealthNow(context.Background()); !health.Ollama || health.Installed || health.Loaded {
		t.Errorf("a model Ollama does not have: %+v", health)
	}
	f.srv.Close()
	if health := s.HealthNow(context.Background()); health.Ollama || health.Installed {
		t.Errorf("Ollama down: %+v", health)
	}
}

func TestHealth(t *testing.T) {
	f := newFakeOllama(t, func(chatRequest) (string, int) { return "", 200 })
	address, _ := start(t, f)
	res, body := call(t, http.MethodGet, address+"/health", "", nil)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"ok":true`) {
		t.Errorf("status %d: %s", res.StatusCode, body)
	}
	f.srv.Close()
	_, body = call(t, http.MethodGet, address+"/health", "", nil)
	if !strings.Contains(string(body), `"ok":false`) {
		t.Errorf("with the model off: %s", body)
	}
}
