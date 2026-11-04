// Command greenhousecheck measures the form scanner on real job postings. It compares
// what the scanner read with the question list Greenhouse publishes for the same job,
// and says what was missed. It only reads pages: it fills in and sends nothing.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/greenhouse"
)

type apiField struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Values []any  `json:"values"`
}

type apiQuestion struct {
	Label    string     `json:"label"`
	Required bool       `json:"required"`
	Fields   []apiField `json:"fields"`
	Answers  []any      `json:"answer_options"`
	Type     string     `json:"type"`
}

type apiJob struct {
	ID          int64         `json:"id"`
	Title       string        `json:"title"`
	AbsoluteURL string        `json:"absolute_url"`
	Questions   []apiQuestion `json:"questions"`
	Location    []apiQuestion `json:"location_questions"`
	Demographic *struct {
		Questions []apiQuestion `json:"questions"`
	} `json:"demographic_questions"`
}

var client = &http.Client{Timeout: 60 * time.Second}

func getJSON(address string, into any) error {
	res, err := client.Get(address)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(into)
}

var notWords = regexp.MustCompile(`[^a-z0-9]+`)

func same(text string) string {
	return strings.Trim(notWords.ReplaceAllString(strings.ToLower(text), " "), " ")
}

func main() {
	boards := flag.String("boards", "discord,stripe", "Greenhouse boards to sample, separated by commas")
	each := flag.Int("jobs", 2, "postings to read from each board")
	viaCompany := flag.Bool("company-links", false, "open each job by its published link instead of Greenhouse's address")
	verbose := flag.Bool("v", false, "print every question read")
	tryFill := flag.Bool("fill", false, "also type made-up values into each form, to see that it takes them. Nothing is sent and no file is attached")
	flag.Parse()

	pw, err := playwright.Run(&playwright.RunOptions{
		DriverDirectory:     filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver"),
		SkipInstallBrowsers: true,
	})
	if err != nil {
		log.Fatalf("could not start the driver: %v", err)
	}
	defer pw.Stop()
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Channel:  playwright.String("chrome"),
		Headless: playwright.Bool(true),
	})
	if err != nil {
		log.Fatalf("could not start Chrome: %v", err)
	}
	defer browser.Close()

	var read, failed, questions, missed, optionsWrong, fillsDone, fillProblems int
	for _, board := range strings.Split(*boards, ",") {
		var list struct {
			Jobs []apiJob `json:"jobs"`
		}
		if err := getJSON("https://boards-api.greenhouse.io/v1/boards/"+board+"/jobs", &list); err != nil {
			fmt.Printf("%-14s the list could not be read: %v\n", board, err)
			continue
		}
		for i, job := range list.Jobs {
			if i >= *each {
				break
			}
			var full apiJob
			if err := getJSON(fmt.Sprintf("https://boards-api.greenhouse.io/v1/boards/%s/jobs/%d?questions=true", board, job.ID), &full); err != nil {
				fmt.Printf("%-14s %d: its questions could not be read: %v\n", board, job.ID, err)
				continue
			}
			link := fmt.Sprintf("https://job-boards.greenhouse.io/%s/jobs/%d", board, job.ID)
			if *viaCompany {
				link = full.AbsoluteURL
			}
			page, err := browser.NewPage()
			if err != nil {
				log.Fatal(err)
			}
			started := time.Now()
			frame, err := greenhouse.Open(page, link)
			var scanned []greenhouse.Question
			if err == nil {
				scanned, err = greenhouse.Scan(frame)
			}
			if err != nil {
				failed++
				fmt.Printf("%-14s %d FAILED after %.0fs at %s: %v\n", board, job.ID, time.Since(started).Seconds(), page.URL(), firstLine(err))
				page.Close()
				continue
			}
			read++
			took := time.Since(started).Seconds()

			byLabel := map[string]greenhouse.Question{}
			for _, q := range scanned {
				byLabel[same(q.Label)] = q
			}
			expected := append(append([]apiQuestion{}, full.Questions...), full.Location...)
			if full.Demographic != nil {
				expected = append(expected, full.Demographic.Questions...)
			}
			var lost, wrong []string
			counted := 0
			for _, want := range expected {
				if allHidden(want) {
					continue
				}
				counted++
				got, ok := byLabel[same(want.Label)]
				// The form words this one differently from the published list.
				if !ok && same(want.Label) == "location" {
					got, ok = byLabel[same("Location (City)")]
				}
				if !ok {
					lost = append(lost, want.Label)
					continue
				}
				// A lone box has no list of choices to compare.
				if n := optionCount(want); n > 0 && n != len(got.Options) && got.Kind != greenhouse.KindCheckbox {
					wrong = append(wrong, fmt.Sprintf("%s: published %d, read %d", want.Label, n, len(got.Options)))
				}
			}
			questions += counted
			missed += len(lost)
			optionsWrong += len(wrong)
			fmt.Printf("%-14s %d read %d questions, published %d, missed %d, choices wrong %d (%.0fs)\n", board, job.ID, len(scanned), counted, len(lost), len(wrong), took)
			for _, label := range lost {
				fmt.Printf("    MISSED: %s\n", label)
			}
			for _, line := range wrong {
				fmt.Printf("    CHOICES: %s\n", line)
			}
			if *verbose {
				for _, q := range scanned {
					mark := " "
					if q.Required {
						mark = "*"
					}
					fmt.Printf("    %s %-12s %-28s %s [%d]\n", mark, q.Kind, cut(q.ID, 28), cut(q.Label, 70), len(q.Options))
				}
			}
			if *tryFill {
				filled, stillEmpty, unfillable := tryFilling(frame, scanned)
				fillsDone += filled
				fillProblems += unfillable + stillEmpty
			}
			page.Close()
			time.Sleep(2 * time.Second)
		}
	}
	fmt.Printf("\nForms read %d, failed %d. Published questions %d, missed %d, with wrong choices %d.\n", read, failed, questions, missed, optionsWrong)
	if *tryFill {
		fmt.Printf("Questions filled %d, problems %d.\n", fillsDone, fillProblems)
	}
}

// tryFilling types made-up values into a real form and reads the form back. It does not
// press the form's button, and attaches nothing, because that would upload a file.
func tryFilling(frame playwright.Frame, scanned []greenhouse.Question) (filled, stillEmpty, unfillable int) {
	var made []greenhouse.Answer
	askable := make([]greenhouse.Question, 0, len(scanned))
	for _, q := range scanned {
		if q.Kind == greenhouse.KindFile {
			continue
		}
		askable = append(askable, q)
		var values []string
		switch q.Kind {
		case greenhouse.KindChoice, greenhouse.KindMultiChoice:
			if len(q.Options) > 0 {
				values = []string{q.Options[0]}
			}
		case greenhouse.KindSearch:
			switch {
			case strings.Contains(q.ID, "location"):
				values = []string{"New York"}
			case strings.Contains(q.ID, "school"):
				values = []string{"Massachusetts Institute", "Other"}
			case strings.Contains(q.ID, "degree"):
				values = []string{"Bachelor", "Other"}
			default:
				values = []string{"Computer", "Other"}
			}
		case greenhouse.KindCheckbox:
			values = []string{"yes"}
		case greenhouse.KindLongText:
			values = []string{"This is a test of the form and is never sent."}
		default:
			values = []string{"Test"}
			if q.ID == "email" {
				values = []string{"test@example.com"}
			}
			if q.ID == "phone" {
				values = []string{"4155550100"}
			}
		}
		made = append(made, greenhouse.Answer{ID: q.ID, Values: values})
	}
	started := time.Now()
	problems := greenhouse.Fill(frame, askable, made, nil)
	for _, p := range problems {
		unfillable++
		fmt.Printf("    COULD NOT FILL %s: %s\n", cut(p.Label, 70), p.Why)
	}
	known := map[string]bool{}
	for _, q := range scanned {
		known[q.ID] = true
	}
	fresh, empty, err := greenhouse.Unanswered(frame, known)
	if err != nil {
		fmt.Printf("    could not read it back: %v\n", firstLine(err))
		return 0, 0, unfillable
	}
	for _, q := range empty {
		if q.Kind == greenhouse.KindFile {
			continue
		}
		stillEmpty++
		fmt.Printf("    STILL EMPTY: %s\n", cut(q.Label, 70))
	}
	for _, q := range fresh {
		fmt.Printf("    NEW QUESTION APPEARED: %s\n", cut(q.Label, 70))
	}
	filled = len(askable) - unfillable
	fmt.Printf("    filled %d of %d in %.0fs, %d still empty, %d new\n", filled, len(askable), time.Since(started).Seconds(), stillEmpty, len(fresh))
	return filled, stillEmpty, unfillable
}

func allHidden(q apiQuestion) bool {
	for _, field := range q.Fields {
		if field.Type != "input_hidden" {
			return false
		}
	}
	return len(q.Fields) > 0
}

func optionCount(q apiQuestion) int {
	if len(q.Answers) > 0 {
		return len(q.Answers)
	}
	for _, field := range q.Fields {
		if len(field.Values) > 0 {
			return len(field.Values)
		}
	}
	return 0
}

func cut(text string, most int) string {
	if len(text) <= most {
		return text
	}
	return text[:most-1] + "…"
}

func firstLine(err error) string {
	line, _, _ := strings.Cut(err.Error(), "\n")
	return line
}
