package greenhouse

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mxschmitt/playwright-go"
)

const formAt = "https://job-boards.greenhouse.io/embed/job_app?for=test&token=1"

// openForm opens the stand-in form in the installed Chrome, at Greenhouse's real address
// but with nothing leaving this computer. Without Chrome or its driver, the test is skipped.
func openForm(t *testing.T) playwright.Page {
	t.Helper()
	driver := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver")
	if _, err := os.Stat(driver); err != nil {
		t.Skip("the browser driver is not on this computer")
	}
	pw, err := playwright.Run(&playwright.RunOptions{DriverDirectory: driver, SkipInstallBrowsers: true})
	if err != nil {
		t.Skipf("could not start the driver: %v", err)
	}
	t.Cleanup(func() { pw.Stop() })
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{Channel: playwright.String("chrome"), Headless: playwright.Bool(true)})
	if err != nil {
		t.Skipf("could not start Chrome: %v", err)
	}
	t.Cleanup(func() { browser.Close() })
	page, err := browser.NewPage()
	if err != nil {
		t.Fatal(err)
	}
	html, err := os.ReadFile(filepath.Join("testdata", "form.html"))
	if err != nil {
		t.Fatal(err)
	}
	if err := page.Route("**/*", func(route playwright.Route) {
		switch address := route.Request().URL(); {
		case strings.HasPrefix(address, "https://job-boards.greenhouse.io/"):
			route.Fulfill(playwright.RouteFulfillOptions{ContentType: playwright.String("text/html"), Body: string(html)})
		case strings.HasPrefix(address, "https://careers.example.com/"):
			route.Fulfill(playwright.RouteFulfillOptions{ContentType: playwright.String("text/html"), Body: `<h1>Careers</h1><iframe id="grnhse_iframe" src="` + formAt + `"></iframe>`})
		default:
			t.Errorf("the test tried to leave this computer: %s", address)
			route.Abort()
		}
	}); err != nil {
		t.Fatal(err)
	}
	return page
}

func scanned(t *testing.T, page playwright.Page) (playwright.Frame, map[string]Question, []Question) {
	t.Helper()
	frame, err := Open(page, formAt)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	questions, err := Scan(frame)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	byID := map[string]Question{}
	for _, q := range questions {
		byID[q.ID] = q
	}
	return frame, byID, questions
}

func TestScan_ReadsEveryQuestionAPersonCanSee(t *testing.T) {
	_, found, questions := scanned(t, openForm(t))

	want := map[string]struct {
		kind, label string
		required    bool
		options     int
	}{
		"first_name":         {KindText, "First Name", true, 0},
		"email":              {KindText, "Email", true, 0},
		"phone":              {KindText, "Phone", false, 0},
		"short":              {KindText, "Short answer", false, 0},
		"resume":             {KindFile, "Resume/CV", true, 0},
		"cover_letter":       {KindFile, "Cover Letter", false, 0},
		"question_1":         {KindLongText, "Why do you want to work here?", true, 0},
		"question_2":         {KindChoice, "Are you authorized to work in the US?", true, 2},
		"question_3":         {KindMultiChoice, "Race or Ethnicity (optional)", false, 4},
		"school--0":          {KindSearch, "School", false, 0},
		"candidate-location": {KindSearch, "Location (City)", false, 0},
		"question_4[]":       {KindMultiChoice, "Where would you work?", true, 3},
		"question_5":         {KindCheckbox, "I have read the privacy notice", false, 0},
		"question_7[]_1":     {KindCheckbox, "I confirm that what I submit is my own work.", true, 0},
		"question_6":         {KindChoice, "Pick a native choice", false, 2},
		"degree--0":          {KindChoice, "Degree", false, 2},
		"start-year--0":      {KindText, "Start date year", false, 0},
		"company-name-0":     {KindText, "Company name", true, 0},
		"end-date-year-0":    {KindText, "End date year", true, 0},
		"current-role-0_1":   {KindCheckbox, "Current role", false, 0},
	}
	for id, w := range want {
		q, ok := found[id]
		if !ok {
			t.Errorf("%s was not read", id)
			continue
		}
		if q.Kind != w.kind || q.Label != w.label || q.Required != w.required || len(q.Options) != w.options {
			t.Errorf("%s read as %+v, want %+v", id, q, w)
		}
	}
	if len(questions) != len(want) {
		t.Errorf("read %d questions, want %d: %+v", len(questions), len(want), questions)
	}
	if found["question_1"].Hint != "A few lines are enough." {
		t.Errorf("question_1 hint = %q", found["question_1"].Hint)
	}
}

func TestScan_LeavesOutWhatIsHiddenFromPeople(t *testing.T) {
	_, found, questions := scanned(t, openForm(t))
	for _, id := range []string{"trap", "token"} {
		if _, ok := found[id]; ok {
			t.Errorf("%s is hidden from people and must not be read", id)
		}
	}
	for _, q := range questions {
		if strings.Contains(q.Label, "banana") || q.Label == "" {
			t.Errorf("read a question that is not one: %+v", q)
		}
	}
}

func TestScan_ChangesNothing(t *testing.T) {
	page := openForm(t)
	frame, _, _ := scanned(t, page)
	again, err := readFields(frame)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range again {
		if q.Filled {
			t.Errorf("scanning filled in %s", q.ID)
		}
	}
}

func TestExpand_AddsRoomForEverySchoolAndJob(t *testing.T) {
	page := openForm(t)
	frame, err := Open(page, formAt)
	if err != nil {
		t.Fatal(err)
	}
	if err := Expand(frame, 3, 2); err != nil {
		t.Fatalf("Expand: %v", err)
	}
	questions, err := Scan(frame)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, q := range questions {
		found[q.ID] = true
	}
	for _, id := range []string{"degree--0", "degree--1", "degree--2", "start-year--2", "company-name-0", "company-name-1", "current-role-1_1"} {
		if !found[id] {
			t.Errorf("%s was not read", id)
		}
	}
	if found["degree--3"] || found["company-name-2"] {
		t.Error("it added more than the résumé needs")
	}
	// Asked again, it adds nothing, and a smaller number takes nothing away.
	if err := Expand(frame, 1, 1); err != nil {
		t.Fatal(err)
	}
	again, err := readFields(frame)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != len(questions) {
		t.Errorf("%d questions, then %d", len(questions), len(again))
	}
}

func TestExpand_LeavesAFormWithNoSectionAlone(t *testing.T) {
	page := openForm(t)
	if err := page.SetContent(`<form id="application-form"><label for="a">A</label><input id="a"></form>`); err != nil {
		t.Fatal(err)
	}
	if err := Expand(page.MainFrame(), 5, 5); err != nil {
		t.Errorf("Expand: %v", err)
	}
}

func TestCurrentRole_TakesAwayThatJobsEndDate(t *testing.T) {
	page := openForm(t)
	frame, err := Open(page, formAt)
	if err != nil {
		t.Fatal(err)
	}
	if err := Expand(frame, 1, 2); err != nil {
		t.Fatal(err)
	}
	questions, err := Scan(frame)
	if err != nil {
		t.Fatal(err)
	}
	answers := []Answer{
		{ID: "company-name-0", Values: []string{"Acme"}},
		{ID: "current-role-0_1", Values: []string{"yes"}},
		{ID: "company-name-1", Values: []string{"Older Co"}},
		{ID: "end-date-year-1", Values: []string{"2019"}},
	}
	var section []Question
	for _, q := range questions {
		if strings.Contains(q.ID, "company-name") || strings.Contains(q.ID, "end-date") || strings.Contains(q.ID, "current-role") {
			section = append(section, q)
		}
	}
	if problems := Fill(frame, section, answers, nil); len(problems) != 0 {
		t.Errorf("a current job needs no end date: %+v", problems)
	}
	after, err := readFields(frame)
	if err != nil {
		t.Fatal(err)
	}
	asked := map[string]bool{}
	for _, q := range after {
		asked[q.ID] = true
	}
	if asked["end-date-year-0"] {
		t.Error("a current job should not be asked its end date")
	}
	if !asked["end-date-year-1"] {
		t.Error("the older job's end date is still asked")
	}
}

func TestOpen_FindsAFormInsideACompanysPage(t *testing.T) {
	page := openForm(t)
	frame, err := Open(page, "https://careers.example.com/jobs?gh_jid=1")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if frame != page.MainFrame() || !strings.HasPrefix(page.URL(), "https://job-boards.greenhouse.io/") {
		t.Errorf("expected the form opened by itself, at %s", page.URL())
	}
}

func TestOpen_SaysSoWhenThereIsNoForm(t *testing.T) {
	saved := formWait
	formWait = 500
	defer func() { formWait = saved }()
	page := openForm(t)
	if _, err := Open(page, "https://careers.example.com/closed"); err != nil {
		t.Logf("with a frame: %v", err)
	}
	if err := page.SetContent("<h1>This job has closed</h1>"); err != nil {
		t.Fatal(err)
	}
	if _, err := findForm(page); err != ErrNoForm {
		t.Errorf("findForm = %v, want ErrNoForm", err)
	}
}

func completeAnswers() []Answer {
	return []Answer{
		{ID: "first_name", Values: []string{"Test"}},
		{ID: "email", Values: []string{"test@example.com"}},
		{ID: "phone", Values: []string{"4155550100"}},
		{ID: "question_1", Values: []string{"Because of the work."}},
		{ID: "question_2", Values: []string{"yes"}},
		{ID: "question_3", Values: []string{"Asian", "White"}},
		{ID: "school--0", Values: []string{"Nowhere College", "Massachusetts Institute of Technology"}},
		{ID: "candidate-location", Values: []string{"New York"}},
		{ID: "question_4[]", Values: []string{"France", "US"}},
		{ID: "question_5", Values: []string{"yes"}},
		{ID: "question_7[]_1", Values: []string{"yes"}},
		{ID: "question_6", Values: []string{"Beta"}},
		{ID: "company-name-0", Values: []string{"Acme"}},
		{ID: "end-date-year-0", Values: []string{"2020"}},
	}
}

func resumeFile(t *testing.T) map[string]string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "Test Resume.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4 test"), 0o600); err != nil {
		t.Fatal(err)
	}
	return map[string]string{"resume": path}
}

func TestFill_PutsEveryAnswerIntoTheForm(t *testing.T) {
	page := openForm(t)
	frame, _, questions := scanned(t, page)

	if problems := Fill(frame, questions, completeAnswers(), resumeFile(t)); len(problems) != 0 {
		t.Fatalf("problems: %+v", problems)
	}
	after, err := readFields(frame)
	if err != nil {
		t.Fatal(err)
	}
	filled := map[string]bool{}
	for _, q := range after {
		filled[q.ID] = q.Filled
	}
	for _, id := range []string{"first_name", "email", "resume", "question_1", "question_2", "question_3", "school--0", "candidate-location", "question_4[]", "question_5", "question_6"} {
		if !filled[id] {
			t.Errorf("%s is empty after filling", id)
		}
	}
	if filled["cover_letter"] || filled["short"] {
		t.Errorf("questions with no answer should stay empty")
	}
	text := func(selector string) string {
		value, err := frame.Locator(selector).First().InnerText()
		if err != nil {
			t.Fatalf("%s: %v", selector, err)
		}
		return value
	}
	if got := text(`.select-shell:has([id="question_2"]) .select__single-value`); got != "Yes" {
		t.Errorf("question_2 shows %q", got)
	}
	if got := text(`.select-shell:has([id="school--0"]) .select__single-value`); got != "Massachusetts Institute of Technology" {
		t.Errorf("the search should fall back to its second wording, shows %q", got)
	}
	if got := text(`.select-shell:has([id="candidate-location"]) .select__single-value`); !strings.HasPrefix(got, "New York") {
		t.Errorf("city shows %q", got)
	}
	checked, err := frame.Locator(`input[name="question_4[]"]:checked`).Count()
	if err != nil || checked != 2 {
		t.Errorf("%d boxes ticked (%v), want 2", checked, err)
	}
}

func TestFill_NeverSendsTheForm(t *testing.T) {
	page := openForm(t)
	frame, _, questions := scanned(t, page)
	Fill(frame, questions, completeAnswers(), resumeFile(t))
	sent, err := frame.Evaluate("() => window.sent")
	if err != nil {
		t.Fatal(err)
	}
	if sent != false {
		t.Error("the form was sent")
	}
}

func TestFill_FindsTheFollowUpAnAnswerMadeAppear(t *testing.T) {
	page := openForm(t)
	frame, _, questions := scanned(t, page)
	if problems := Fill(frame, questions, completeAnswers(), resumeFile(t)); len(problems) != 0 {
		t.Fatalf("problems: %+v", problems)
	}
	known := map[string]bool{}
	for _, q := range questions {
		known[q.ID] = true
	}
	fresh, empty, err := Unanswered(frame, known)
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh) != 1 || fresh[0].ID != "question_9" || !fresh[0].Required {
		t.Errorf("fresh = %+v, want the follow-up question", fresh)
	}
	if len(empty) != 0 {
		t.Errorf("still empty = %+v", empty)
	}
}

func TestFill_RefusesAnswersTheFormDoesNotOffer(t *testing.T) {
	page := openForm(t)
	frame, _, questions := scanned(t, page)
	answers := []Answer{
		{ID: "question_2", Values: []string{"Maybe"}},
		{ID: "question_4[]", Values: []string{"Atlantis"}},
		{ID: "question_6", Values: []string{"Gamma"}},
		{ID: "trap", Values: []string{"banana"}},
		{ID: "not_on_this_form", Values: []string{"anything"}},
	}
	problems := Fill(frame, questions, answers, nil)
	why := map[string]string{}
	for _, p := range problems {
		why[p.ID] = p.Why
	}
	for _, id := range []string{"question_2", "question_4[]"} {
		if !strings.Contains(why[id], "not one of") {
			t.Errorf("%s: %q", id, why[id])
		}
	}
	if !strings.Contains(why["question_6"], "not one of") {
		t.Errorf("question_6 is optional but the answer is wrong, so it should be reported: %q", why["question_6"])
	}
	if _, ok := why["trap"]; ok {
		t.Error("an answer to something that was not scanned should be dropped, not tried")
	}
	held, err := frame.Locator("#trap").InputValue()
	if err != nil {
		t.Fatal(err)
	}
	if held != "" {
		t.Errorf("the hidden box was filled with %q", held)
	}
}

func TestFill_ReportsWhatItCannotAnswer(t *testing.T) {
	page := openForm(t)
	frame, _, questions := scanned(t, page)
	problems := Fill(frame, questions, []Answer{{ID: "short", Values: []string{"far too long for this box"}}, {ID: "school--0", Values: []string{"Nowhere College"}}}, nil)
	why := map[string]string{}
	for _, p := range problems {
		why[p.ID] = p.Why
	}
	checks := map[string]string{
		"first_name": "no answer",
		"question_1": "no answer",
		"resume":     "requires a file",
		"short":      "too long",
		"school--0":  "no result",
	}
	for id, part := range checks {
		if !strings.Contains(why[id], part) {
			t.Errorf("%s: %q should mention %q", id, why[id], part)
		}
	}
	if _, ok := why["cover_letter"]; ok {
		t.Error("an optional file with nothing to attach is not a problem")
	}
}

func TestIsJobLink(t *testing.T) {
	cases := map[string]bool{
		"https://job-boards.greenhouse.io/discord/jobs/1":   true,
		"https://boards.greenhouse.io/stripe/jobs/1":        true,
		"https://careers.airbnb.com/positions/1?gh_jid=1":   true,
		"https://jobs.lever.co/acme/1":                      false,
		"https://greenhouse.io.evil.example/discord/jobs/1": false,
		"javascript:alert(1)":                               false,
		"not a link":                                        false,
	}
	for link, want := range cases {
		if got := IsJobLink(link); got != want {
			t.Errorf("IsJobLink(%q) = %v, want %v", link, got, want)
		}
	}
}

func TestFormLink(t *testing.T) {
	cases := map[string]string{
		"https://job-boards.greenhouse.io/discord/jobs/123?utm=1":          formAddress("discord", "123"),
		"https://boards.greenhouse.io/stripe/jobs/9":                       formAddress("stripe", "9"),
		"https://boards.greenhouse.io/embed/job_app?for=acme&token=7":      formAddress("acme", "7"),
		"https://job-boards.greenhouse.io/embed/job_app?for=a%26b&token=7": "https://job-boards.greenhouse.io/embed/job_app?for=a%26b&token=7",
		"https://careers.airbnb.com/positions/1?gh_jid=1":                  "",
		"https://greenhouse.io.evil.example/discord/jobs/1":                "",
	}
	for link, want := range cases {
		got, ok := FormLink(link)
		if ok != (want != "") || got != want {
			t.Errorf("FormLink(%q) = %q, %v, want %q", link, got, ok, want)
		}
	}
}
