// Command modeltry puts real application questions to the real model, with a made-up
// applicant, and prints every answer with how long it took. It is how the owner's prompt
// and the model are judged before any member relies on them. Nothing goes to a job site.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"stealth-app/internal/answers"
	"stealth-app/internal/modelserver"
)

const madeUpResume = `{
  "info": {"name": "Sam Example", "title": "Senior Backend Engineer", "location": "Austin, TX", "email": "sam@example.com", "phone": "+1 555 0199", "linkedin": "https://linkedin.com/in/samexample"},
  "summary": "Backend engineer with eight years building payment and billing systems in Go and Python.",
  "skills": [{"category": "Languages", "skills": ["Go", "Python", "SQL"]}, {"category": "Infrastructure", "skills": ["AWS", "Kubernetes", "PostgreSQL", "Kafka"]}],
  "experience": [
    {"title": "Senior Backend Engineer", "company": "Northwind Payments", "startDate": "2021", "endDate": "Present", "location": "Austin, TX", "descriptionLines": ["Led the move of the invoicing service from a monolith to Go services on Kubernetes.", "Reduced failed payment retries by 30% by redesigning the retry queue on Kafka.", "Mentored three engineers and ran the on-call rotation for billing."]},
    {"title": "Software Engineer", "company": "Contoso Retail", "startDate": "2017", "endDate": "2021", "location": "Dallas, TX", "descriptionLines": ["Built checkout APIs in Python serving the web and mobile apps.", "Added PostgreSQL read replicas to keep reporting from slowing down checkout."]}
  ],
  "certifications": [],
  "education": [{"degree": "Bachelor of Science", "major": "Computer Science", "school": "University of Texas at Austin", "startDate": "2013", "endDate": "2017"}]
}`

const madeUpJob = `We are hiring a Senior Backend Engineer to work on our billing platform.

You will design and run Go services that handle subscription billing and invoicing for millions of customers. You will work with product and finance, and take ownership of reliability.

What we look for: 5+ years of backend engineering; strong Go or similar; distributed systems and message queues such as Kafka; PostgreSQL at scale; experience mentoring engineers. Experience with tax or revenue recognition is a plus.

This role is based in the United States. We do not offer visa sponsorship for this role.`

func main() {
	address := flag.String("ollama", "http://127.0.0.1:11434", "where Ollama is")
	model := flag.String("model", "qwen3:8b", "the model")
	contextSize := flag.Int("context", 8192, "how much text, in tokens, the model holds at once")
	flag.Parse()

	req := answers.Request{
		Job:    answers.Job{Company: "Example Billing Co", Title: "Senior Backend Engineer", Location: "United States", Description: madeUpJob},
		Resume: json.RawMessage(madeUpResume),
		Info: answers.Info{
			FirstName: "Sam", LastName: "Example", Email: "sam@example.com", Phone: "+1 555 0199", Country: "United States", City: "Austin",
			Facts: []answers.Fact{
				{Question: "Work authorization", Answer: "I am authorized to work in the United States."},
				{Question: "Visa sponsorship", Answer: "I do not need visa sponsorship, now or in the future."},
			},
		},
		Questions: []answers.Question{
			{ID: "first_name", Kind: answers.KindText, Label: "First Name", Required: true},
			{ID: "email", Kind: answers.KindText, Label: "Email", Required: true},
			{ID: "q_why", Kind: answers.KindLongText, Label: "Why do you want to work at Example Billing Co?", Required: true},
			{ID: "q_kafka", Kind: answers.KindLongText, Label: "Describe your experience with message queues such as Kafka.", Required: true},
			{ID: "q_tax", Kind: answers.KindLongText, Label: "Describe your experience with revenue recognition.", Required: true},
			{ID: "q_auth", Kind: answers.KindChoice, Label: "Are you legally authorized to work in the United States?", Required: true, Options: []string{"Yes", "No"}},
			{ID: "q_visa", Kind: answers.KindChoice, Label: "Will you now or in the future require sponsorship for employment visa status?", Required: true, Options: []string{"Yes", "No"}},
			{ID: "q_former", Kind: answers.KindChoice, Label: "Have you ever been employed by Example Billing Co?", Required: true, Options: []string{"Yes", "No"}},
			{ID: "q_years", Kind: answers.KindText, Label: "How many years of backend engineering experience do you have?", Required: true},
			{ID: "q_employer", Kind: answers.KindText, Label: "Who is your current or previous employer?", Required: true},
			{ID: "q_salary", Kind: answers.KindText, Label: "What are your salary expectations?", Required: true},
			{ID: "q_state", Kind: answers.KindChoice, Label: "What U.S. state do you currently reside in?", Required: true, Options: []string{"California", "New York", "Texas", "Washington"}},
			{ID: "q_clearance", Kind: answers.KindChoice, Label: "Do you hold an active US government security clearance?", Required: true, Options: []string{"Yes", "No"}},
			{ID: "q_gender", Kind: answers.KindChoice, Label: "Gender", Required: true, Options: []string{"Male", "Female", "Decline To Self Identify"}},
			{ID: "q_consent", Kind: answers.KindCheckbox, Label: "I affirm that all the information I submit reflects my own work and experience.", Required: true},
		},
	}

	server := modelserver.New(modelserver.Config{
		Model:   &modelserver.Model{Address: *address, Name: *model, Prompt: modelserver.Prompt(), Client: &http.Client{}, ContextSize: *contextSize},
		Check:   func(context.Context, string) (string, error) { return "try", nil },
		Workers: 1,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go server.Run(ctx)
	front := httptest.NewServer(server.Handler())
	defer front.Close()

	asked := make(map[string]answers.Question, len(req.Questions))
	for _, q := range req.Questions {
		asked[q.ID] = q
	}
	// One at a time, so that each answer's own time can be seen.
	replied := map[string]string{}
	started := time.Now()
	for _, q := range req.Questions {
		one := req
		one.Questions = []answers.Question{q}
		began := time.Now()
		progress := send(front.URL, one)
		took := time.Since(began).Seconds()
		switch {
		case progress.State == answers.StateFailed:
			replied[q.ID] = "FAILED: " + progress.Error
		case len(progress.Reply.Answers) > 0:
			replied[q.ID] = strings.Join(progress.Reply.Answers[0].Values, " | ")
		case len(progress.Reply.Asks) > 0:
			replied[q.ID] = "ASK THE MEMBER: " + progress.Reply.Asks[0].Why
		default:
			replied[q.ID] = "(left empty)"
		}
		fmt.Printf("%5.1fs  %s\n        -> %s\n", took, q.Label, replied[q.ID])
	}
	fmt.Printf("\nAll %d questions, one request each: %.0fs\n", len(req.Questions), time.Since(started).Seconds())

	began := time.Now()
	progress := send(front.URL, req)
	if progress.State == answers.StateDone {
		fmt.Printf("The same job as one request (the way a browser sends it): %.0fs\n", time.Since(began).Seconds())
	}
}

func send(front string, req answers.Request) answers.Progress {
	body, err := json.Marshal(req)
	if err != nil {
		log.Fatal(err)
	}
	make := func(method, address string, payload string) answers.Progress {
		r, err := http.NewRequest(method, address, strings.NewReader(payload))
		if err != nil {
			log.Fatal(err)
		}
		r.Header.Set("Authorization", "Bearer kapp_try")
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			log.Fatal(err)
		}
		defer res.Body.Close()
		var out answers.Progress
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			log.Fatal(err)
		}
		return out
	}
	started := make(http.MethodPost, front+"/v1/answers", string(body))
	for {
		now := make(http.MethodGet, front+"/v1/answers/"+started.Ticket, "")
		if now.State == answers.StateDone || now.State == answers.StateFailed {
			return now
		}
		time.Sleep(200 * time.Millisecond)
	}
}
