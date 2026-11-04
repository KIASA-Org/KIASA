// Command formtry runs one real job form through the whole answer chain, with the real model
// and a made-up applicant, then prints every answer and saves a picture of the filled form.
// It is how a form's result is checked by eye. Nothing is sent, and no file is attached.
//
// Usage: go run ./tools/formtry -applicant applicant.json -out folder link [link...]
// The applicant file holds {"resume": {...}, "details": {...}}.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
	"stealth-app/internal/greenhouse"
	"stealth-app/internal/modelserver"
)

func main() {
	applicant := flag.String("applicant", "", "a file with the made-up applicant's résumé and details")
	out := flag.String("out", ".", "where to save the pictures")
	model := flag.String("model", "qwen3:8b", "the model")
	flag.Parse()

	raw, err := os.ReadFile(*applicant)
	if err != nil {
		log.Fatal(err)
	}
	var person struct {
		Resume  json.RawMessage `json:"resume"`
		Details answers.Info    `json:"details"`
	}
	if err := json.Unmarshal(raw, &person); err != nil {
		log.Fatal(err)
	}
	var entries struct {
		Education  []json.RawMessage `json:"education"`
		Experience []json.RawMessage `json:"experience"`
	}
	json.Unmarshal(person.Resume, &entries)

	server := modelserver.New(modelserver.Config{
		Model:   &modelserver.Model{Address: "http://127.0.0.1:11434", Name: *model, Prompt: modelserver.Prompt(), Client: &http.Client{}, ContextSize: 8192},
		Check:   func(context.Context, string) (string, error) { return "try", nil },
		Workers: 1,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go server.Run(ctx)
	front := httptest.NewServer(server.Handler())
	defer front.Close()
	client := answers.Client{Address: front.URL, Key: "kapp_try", HTTP: &http.Client{Timeout: 30 * time.Second}}

	pw, err := playwright.Run(&playwright.RunOptions{DriverDirectory: filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver"), SkipInstallBrowsers: true})
	if err != nil {
		log.Fatal(err)
	}
	defer pw.Stop()
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{Channel: playwright.String("chrome"), Headless: playwright.Bool(true)})
	if err != nil {
		log.Fatal(err)
	}
	defer browser.Close()

	notName := regexp.MustCompile(`[^a-zA-Z0-9]+`)
	for _, link := range flag.Args() {
		fmt.Printf("\n===== %s\n", link)
		page, err := browser.NewPage(playwright.BrowserNewPageOptions{Viewport: &playwright.Size{Width: 1100, Height: 900}})
		if err != nil {
			log.Fatal(err)
		}
		frame, err := greenhouse.Open(page, link)
		if err != nil {
			fmt.Println("could not open:", err)
			page.Close()
			continue
		}
		if err := greenhouse.Expand(frame, len(entries.Education), len(entries.Experience)); err != nil {
			fmt.Println("could not add room:", err)
		}
		known := map[string]bool{}
		batch, err := greenhouse.Scan(frame)
		if err != nil {
			fmt.Println("could not read:", err)
			page.Close()
			continue
		}
		for round := 0; round <= 3 && len(batch) > 0; round++ {
			questions := make([]answers.Question, 0, len(batch))
			for _, q := range batch {
				label := q.Label
				if label == "" {
					label = q.ID
				}
				questions = append(questions, answers.Question{ID: q.ID, Kind: q.Kind, Label: label, Required: q.Required, Hint: q.Hint, Options: q.Options})
			}
			reply, err := client.Ask(ctx, answers.Request{Job: posting(link), Resume: person.Resume, Info: person.Details, Questions: questions}, nil)
			if err != nil {
				fmt.Println("the server did not answer:", err)
				break
			}
			if reply.Stop != "" {
				fmt.Println("   STOPPED:", reply.Stop)
				break
			}
			given := map[string]string{}
			var fill []greenhouse.Answer
			for _, a := range reply.Answers {
				given[a.ID] = strings.Join(a.Values, " | ")
				fill = append(fill, greenhouse.Answer{ID: a.ID, Values: a.Values})
			}
			for _, q := range questions {
				answer, ok := given[q.ID]
				if !ok {
					answer = "(left empty)"
				}
				mark := " "
				if q.Required {
					mark = "*"
				}
				options := ""
				if len(q.Options) > 0 && len(q.Options) <= 12 {
					options = "  {" + cut(strings.Join(q.Options, " / "), 120) + "}"
				}
				fmt.Printf(" %s %-12s %-24s %-60s -> %s%s\n", mark, q.Kind, cut(q.ID, 24), cut(q.Label, 60), cut(answer, 420), options)
			}
			for _, one := range reply.Asks {
				fmt.Printf("   ASKS THE MEMBER: %s (%s)\n", cut(one.Label, 90), one.Why)
			}
			for _, p := range greenhouse.Fill(frame, batch, fill, nil) {
				fmt.Printf("   PROBLEM: %s: %s\n", cut(p.Label, 70), p.Why)
			}
			for _, q := range batch {
				known[q.ID] = true
			}
			fresh, empty, err := greenhouse.Unanswered(frame, known)
			if err != nil {
				fmt.Println("could not read it back:", err)
				break
			}
			for _, q := range empty {
				if q.Kind != greenhouse.KindFile {
					fmt.Printf("   STILL EMPTY: %s\n", cut(q.Label, 80))
				}
			}
			batch = fresh
		}
		name := notName.ReplaceAllString(link, "_")
		if len(name) > 60 {
			name = name[len(name)-60:]
		}
		path := filepath.Join(*out, name+".png")
		if _, err := page.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(path), FullPage: playwright.Bool(true)}); err != nil {
			fmt.Println("no picture:", err)
		} else {
			fmt.Println("picture:", path)
		}
		page.Close()
	}
}

var (
	tags   = regexp.MustCompile(`<[^>]+>`)
	spaces = regexp.MustCompile(`\s+`)
)

// posting reads the job's title and description, as KIASA holds them for a real job.
func posting(link string) answers.Job {
	job := answers.Job{Title: "Software Engineer"}
	u, err := url.Parse(link)
	if err != nil {
		return job
	}
	board, token := u.Query().Get("for"), u.Query().Get("token")
	job.Company = board
	res, err := http.Get("https://boards-api.greenhouse.io/v1/boards/" + url.PathEscape(board) + "/jobs/" + url.PathEscape(token))
	if err != nil {
		return job
	}
	defer res.Body.Close()
	var found struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if json.NewDecoder(res.Body).Decode(&found) == nil && found.Title != "" {
		job.Title = found.Title
		job.Description = spaces.ReplaceAllString(tags.ReplaceAllString(html.UnescapeString(found.Content), " "), " ")
	}
	return job
}

func cut(text string, most int) string {
	runes := []rune(strings.Join(strings.Fields(text), " "))
	if len(runes) <= most {
		return string(runes)
	}
	return string(runes[:most-1]) + "…"
}
