package modelserver

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"stealth-app/internal/answers"
)

// decision is what happens to one question before the model is asked.
type decision int

const (
	askModel  decision = iota // the model writes the answer
	answered                  // the answer is exact, and comes from what the member saved
	askMember                 // only the member can say
	stopJob                   // the agent should not go on with this form
	leaveOut                  // nothing to do: the browser attaches files, optional ones can stay empty
)

type verdict struct {
	decision decision
	values   []string
	why      string
	// askAs words the question for the member when the form's own wording is not enough, as
	// with "Start date month", which every school and job on a form has.
	askAs string
}

func exact(values ...string) verdict { return verdict{decision: answered, values: values} }

func member(why string) verdict { return verdict{decision: askMember, why: why} }

// missing is for a detail the member has not saved: only a required question needs them.
func missing(q answers.Question, what string) verdict {
	if q.Required {
		return member("Add your " + what + " on the Auto apply page.")
	}
	return verdict{decision: leaveOut}
}

var (
	educationField   = regexp.MustCompile(`^(school|degree|discipline|start-month|start-year|end-month|end-year)--(\d+)$`)
	employmentField  = regexp.MustCompile(`^(company-name|title|start-date-month|start-date-year|end-date-month|end-date-year)-(\d+)$`)
	currentRoleField = regexp.MustCompile(`^current-role-(\d+)_\d+$`)
	demographic      = regexp.MustCompile(`(?i)\b(gender|race|racial|ethnic\w*|hispanic|latin[oax]+|veteran|military|disability|disabled|lgbt\w*|sexual orientation|transgender|pronouns?)\b`)
	declines         = regexp.MustCompile(`(?i)(decline|don'?t wish|do not wish|prefer not|rather not|not to (say|answer|disclose|self))`)
	// A statement the member would be making themselves, whatever kind of box it is in.
	statement = regexp.MustCompile(`(?i)(\bi (accept|acknowledge|agree|affirm|attest|certify|confirm|consent|understand)\b|\bby (checking|clicking|selecting|signing|submitting|ticking|typing)\b|\backnowledge\b)`)
)

// legalTopics are questions whose answer is a statement about the member's legal standing.
// Each goes to the model only once the member has saved an answer on it: a guess here would
// be a false statement made in their name. Their names are the Auto apply page's.
var legalTopics = []struct {
	name string
	asks *regexp.Regexp
}{
	{"Work authorization", regexp.MustCompile(`(?i)\b(authori[sz]ed|authori[sz]ation|eligib\w*|entitled|permitted|legally|right)\b.*\bwork\b|\bwork\b.*\b(authori[sz]ation|permit|eligib\w*|right)\b`)},
	{"Visa sponsorship", regexp.MustCompile(`(?i)\bsponsor\w*|\bvisa\b`)},
	{"Citizenship", regexp.MustCompile(`(?i)\bcitizen\w*|\bnationality\b|\bgreen card\b|\bpermanent resident\b|\bu\.?s\.? person\b`)},
	{"Security clearance", regexp.MustCompile(`(?i)\bclearance\b`)},
	{"Criminal record", regexp.MustCompile(`(?i)\bconvict\w*|\bfelon\w*|\bcriminal\b|\bmisdemean\w*|\bbackground check\b|\bdebarred\b`)},
	{"Work restrictions", regexp.MustCompile(`(?i)\bnon-?compete\b|\bnon-?solicit\w*|\brestrictive covenants?\b|\bpost-employment\b|\bsubject to any\b.*\bagreement\b|\bemployment agreements?\b`)},
}

// unsavedLegalTopic names a legal topic this question is about that the member has not
// answered, if there is one.
func unsavedLegalTopic(label string, facts []answers.Fact) (string, bool) {
	for _, topic := range legalTopics {
		if !topic.asks.MatchString(label) {
			continue
		}
		saved := false
		for _, fact := range facts {
			saved = saved || (normal(fact.Question) == normal(topic.name) && strings.TrimSpace(fact.Answer) != "")
		}
		if !saved {
			return topic.name, true
		}
	}
	return "", false
}

// resumeFacts is the part of a résumé the exact rules use.
type resumeFacts struct {
	Info struct {
		LinkedIn string `json:"linkedin"`
		Location string `json:"location"`
	} `json:"info"`
	Education []struct {
		Degree    string `json:"degree"`
		Major     string `json:"major"`
		School    string `json:"school"`
		StartDate string `json:"startDate"`
		EndDate   string `json:"endDate"`
	} `json:"education"`
	Experience []struct {
		Title     string `json:"title"`
		Company   string `json:"company"`
		StartDate string `json:"startDate"`
		EndDate   string `json:"endDate"`
	} `json:"experience"`
}

func readResume(raw json.RawMessage) resumeFacts {
	var facts resumeFacts
	json.Unmarshal(raw, &facts)
	return facts
}

func normal(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}

// decide settles what it can without the model: details that must be copied exactly, what
// the member has already said, and what only they may say. The model never retypes an
// email address, and never agrees to anything for anyone.
func decide(q answers.Question, req *answers.Request, resume resumeFacts) verdict {
	if q.Kind == answers.KindFile {
		return verdict{decision: leaveOut}
	}
	if asksIfHuman(q) {
		return verdict{decision: stopJob, why: "This form checks whether a person is filling it in, so the agent left it for you to do yourself."}
	}
	if v, ok := heardAbout(q); ok {
		return v
	}
	// Which school or job these belong to is what matters, so they come before anything saved
	// under the same words: every entry on a form has a "Start date month".
	if v, ok := educationDetail(q, req.Info.Facts, resume); ok {
		return v
	}
	if v, ok := employmentDetail(q, req.Info.Facts, resume); ok {
		return v
	}
	if said, ok := savedAnswer(q, req.Info.Facts); ok {
		return said
	}
	if v, ok := contactDetail(q, req.Info, resume); ok {
		return v
	}
	if (demographic.MatchString(q.Label) || asksGenderByOptions(q) || asksTransgenderByOptions(q)) && (q.Kind == answers.KindChoice || q.Kind == answers.KindMultiChoice) {
		if option, ok := demographicChoice(q, req.Info.Facts); ok {
			return exact(option)
		}
		return declined(q)
	}
	if topic, unsaved := unsavedLegalTopic(q.Label, req.Info.Facts); unsaved {
		if q.Required {
			return member("Only you can answer this. Add your " + strings.ToLower(topic) + " on the Auto apply page, or answer it here.")
		}
		return verdict{decision: leaveOut}
	}
	if q.Kind == answers.KindCheckbox || statement.MatchString(q.Label) || agreesInItsChoices(q) {
		if !q.Required {
			return verdict{decision: leaveOut}
		}
		if req.Info.AgreeForMe == "yes" {
			if v, ok := agreed(q); ok {
				return v
			}
		}
		return member("This is a statement you make yourself, so the agent does not agree to it for you.")
	}
	return verdict{decision: askModel}
}

// savedAnswer finds the member's own answer to this very question.
func savedAnswer(q answers.Question, facts []answers.Fact) (verdict, bool) {
	label := normal(q.Label)
	for _, fact := range facts {
		if normal(fact.Question) != label || strings.TrimSpace(fact.Answer) == "" {
			continue
		}
		if q.Kind == answers.KindChoice || q.Kind == answers.KindMultiChoice {
			option, ok := optionFor(q.Options, fact.Answer)
			if !ok {
				continue
			}
			return exact(option), true
		}
		return exact(fact.Answer), true
	}
	return verdict{}, false
}

func optionFor(options []string, value string) (string, bool) {
	want := normal(value)
	for _, option := range options {
		if normal(option) == want {
			return option, true
		}
	}
	return "", false
}

// contactDetail answers the questions about who the member is and how to reach them.
func contactDetail(q answers.Question, info answers.Info, resume resumeFacts) (verdict, bool) {
	label := normal(q.Label)
	fill := func(value, what string) (verdict, bool) {
		if strings.TrimSpace(value) == "" {
			return missing(q, what), true
		}
		return exact(value), true
	}
	switch {
	case q.ID == "first_name" || q.ID == "preferred_name" || label == "first name" || label == "legal first name" || label == "preferred first name" || label == "preferred name":
		return fill(info.FirstName, "first name")
	case q.ID == "last_name" || label == "last name" || label == "legal last name":
		return fill(info.LastName, "last name")
	case label == "full name" || label == "name":
		return fill(strings.TrimSpace(info.FirstName+" "+info.LastName), "name")
	case q.ID == "email" || label == "email" || label == "email address":
		return fill(info.Email, "email")
	case q.ID == "phone" || label == "phone" || label == "phone number":
		return fill(info.Phone, "phone")
	case q.ID == "candidate-location":
		return fill(info.City, "city")
	case q.Kind == answers.KindText && (strings.Contains(label, "mailing address") || strings.Contains(label, "street address") || strings.Contains(label, "home address") || strings.Contains(label, "present address") || strings.Contains(label, "current address") || label == "address"):
		return fill(info.Address, "street address")
	case q.Kind == answers.KindText && (label == "city" || label == "current city"):
		return fill(info.City, "city")
	case q.Kind == answers.KindText && zipQuestion.MatchString(label):
		return fill(info.Zip, "zip code")
	case stateQuestion.MatchString(label):
		return stateChoice(q, info, resume)
	case q.ID == "country":
		return countryChoice(q, info.Country)
	}
	if q.Kind != answers.KindText && q.Kind != answers.KindLongText {
		return verdict{}, false
	}
	switch {
	case linkedInQuestion.MatchString(label):
		if info.LinkedIn != "" {
			return exact(info.LinkedIn), true
		}
		return fill(resume.Info.LinkedIn, "LinkedIn address")
	case strings.Contains(label, "github"):
		return fill(info.GitHub, "GitHub address")
	case label == "website" || strings.Contains(label, "portfolio") || strings.Contains(label, "personal site"):
		return fill(info.Website, "website")
	}
	return verdict{}, false
}

var (
	linkedInQuestion = regexp.MustCompile(`(?i)\blinked\s?in\b`)
	zipQuestion      = regexp.MustCompile(`(?i)\b(zip|postal)\s*(code)?\b`)
	stateQuestion    = regexp.MustCompile(`(?i)^state\b|\bstate of residence\b|\bstate do you\b|\bstate are you\b|\b(which|what) (u\.?s\.? )?state\b|\bstate you (live|reside)\b`)
)

var usStates = map[string]string{
	"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
	"DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
	"KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
	"MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
	"NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
	"SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
	"WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

// memberState finds the member's state: what they saved, or the end of their résumé's location.
func memberState(info answers.Info, resume resumeFacts) (short, full string) {
	text := strings.TrimSpace(info.State)
	if text == "" {
		parts := strings.Split(resume.Info.Location, ",")
		if len(parts) > 1 {
			text = strings.TrimSpace(parts[len(parts)-1])
		}
	}
	for abbreviation, name := range usStates {
		if strings.EqualFold(text, abbreviation) || strings.EqualFold(text, name) {
			return abbreviation, name
		}
	}
	return "", ""
}

// stateChoice answers which state the member lives in, in the form's own wording of it.
func stateChoice(q answers.Question, info answers.Info, resume resumeFacts) (verdict, bool) {
	short, full := memberState(info, resume)
	if short == "" {
		return missing(q, "state"), true
	}
	if q.Kind != answers.KindChoice && q.Kind != answers.KindMultiChoice {
		return exact(full), true
	}
	for _, option := range q.Options {
		if have := normal(option); have == normal(full) || have == normal(short) || strings.HasPrefix(have, normal(full)+" ") {
			return exact(option), true
		}
	}
	// Some companies list only the states they hire in. No other state is ever picked instead.
	if q.Required {
		return member("Your state is not one of this form's choices."), true
	}
	return verdict{decision: leaveOut}, true
}

// countryChoice picks the country beside a phone number. The form's wording of a country
// also has its dialling code, so the option has to start with the name.
func countryChoice(q answers.Question, country string) (verdict, bool) {
	want := normal(country)
	if want == "" {
		return missing(q, "country"), true
	}
	for _, option := range q.Options {
		have := normal(option)
		if have == want || strings.HasPrefix(have, want+" ") || strings.HasPrefix(have, want+",") {
			return exact(option), true
		}
	}
	if q.Required {
		return member("Your saved country is not one of this form's choices."), true
	}
	return verdict{decision: leaveOut}, true
}

// educationDetail copies the résumé's education into the form's school, degree and
// discipline boxes, one entry to each numbered set.
func educationDetail(q answers.Question, facts []answers.Fact, resume resumeFacts) (verdict, bool) {
	found := educationField.FindStringSubmatch(q.ID)
	if found == nil {
		return verdict{}, false
	}
	index, _ := strconv.Atoi(found[2])
	if index >= len(resume.Education) {
		return missing(q, "education on your résumé"), true
	}
	entry := resume.Education[index]
	switch found[1] {
	case "start-month":
		return dateDetail(q, "month", entry.StartDate, "Start month at "+entry.School, facts), true
	case "end-month":
		return dateDetail(q, "month", entry.EndDate, "End month at "+entry.School, facts), true
	case "start-year":
		return dateDetail(q, "year", entry.StartDate, "Start year at "+entry.School, facts), true
	case "end-year":
		return dateDetail(q, "year", entry.EndDate, "End year at "+entry.School, facts), true
	}
	value := map[string]string{"school": entry.School, "degree": entry.Degree, "discipline": entry.Major}[found[1]]
	if strings.TrimSpace(value) == "" {
		return missing(q, "education on your résumé"), true
	}
	if q.Kind == answers.KindSearch {
		if found[1] == "degree" {
			// A degree is looked for by its wording, then its level. "Other" would be untrue.
			if level := degreeLevel(value); level != "" {
				return exact(value, level), true
			}
			return exact(value), true
		}
		// A school the form's list does not have is what its "Other" is for.
		return exact(value, "Other"), true
	}
	if option, ok := closestDegree(q.Options, value); ok {
		return exact(option), true
	}
	if q.Required {
		return member("Your education on your résumé does not match this form's choices."), true
	}
	return verdict{decision: leaveOut}, true
}

// degreeLevel is the word a form's list of degrees would have for this level.
func degreeLevel(value string) string {
	have := normal(value)
	for word, level := range map[string]string{"phd": "Doctor", "ph.d": "Doctor", "doctor": "Doctor", "master": "Master", "mba": "Master", "bachelor": "Bachelor", "associate": "Associate"} {
		if strings.Contains(have, word) {
			return level
		}
	}
	return ""
}

// employmentDetail copies the résumé's jobs into a form's work history, one job to each
// numbered set, in the résumé's order. Only what the résumé says goes in: a gap between jobs
// stays a gap, because no job or date is ever made up to close it.
func employmentDetail(q answers.Question, facts []answers.Fact, resume resumeFacts) (verdict, bool) {
	if found := currentRoleField.FindStringSubmatch(q.ID); found != nil {
		index, _ := strconv.Atoi(found[1])
		if index < len(resume.Experience) {
			if _, _, current := parseDate(resume.Experience[index].EndDate); current {
				return exact("yes"), true
			}
		}
		return verdict{decision: leaveOut}, true
	}
	found := employmentField.FindStringSubmatch(q.ID)
	if found == nil {
		return verdict{}, false
	}
	index, _ := strconv.Atoi(found[2])
	if index >= len(resume.Experience) {
		return missing(q, "work history on your résumé"), true
	}
	job := resume.Experience[index]
	where := job.Company
	switch found[1] {
	case "company-name":
		if strings.TrimSpace(job.Company) == "" {
			return missing(q, "work history on your résumé"), true
		}
		return exact(job.Company), true
	case "title":
		if strings.TrimSpace(job.Title) == "" {
			return missing(q, "work history on your résumé"), true
		}
		return exact(job.Title), true
	case "start-date-month":
		return dateDetail(q, "month", job.StartDate, "Start month at "+where, facts), true
	case "start-date-year":
		return dateDetail(q, "year", job.StartDate, "Start year at "+where, facts), true
	}
	// A current job has no end: "Current role" says so instead.
	if _, _, current := parseDate(job.EndDate); current {
		return verdict{decision: leaveOut}, true
	}
	if found[1] == "end-date-month" {
		return dateDetail(q, "month", job.EndDate, "End month at "+where, facts), true
	}
	return dateDetail(q, "year", job.EndDate, "End year at "+where, facts), true
}

var (
	yearInDate  = regexp.MustCompile(`\b(19|20)\d{2}\b`)
	monthName   = regexp.MustCompile(`(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b`)
	monthNumber = regexp.MustCompile(`\b(\d{1,2})[/-]((?:19|20)\d{2})\b|\b((?:19|20)\d{2})[/-](\d{1,2})\b`)
	stillThere  = regexp.MustCompile(`(?i)\b(present|current|now|today|ongoing)\b`)
	months      = []string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}
)

// parseDate reads a résumé's date, as in "May 2021", "05/2021", "2021" or "Present".
func parseDate(text string) (month, year string, current bool) {
	text = strings.TrimSpace(text)
	if stillThere.MatchString(text) {
		return "", "", true
	}
	year = yearInDate.FindString(text)
	if found := monthName.FindStringSubmatch(text); found != nil {
		for _, name := range months {
			if strings.EqualFold(name[:3], found[1]) {
				month = name
			}
		}
	} else if found := monthNumber.FindStringSubmatch(text); found != nil {
		digits := found[1] + found[4]
		if n, err := strconv.Atoi(digits); err == nil && n >= 1 && n <= 12 {
			month = months[n-1]
		}
	}
	return month, year, false
}

// dateDetail answers a date box from a résumé's date. When the résumé does not hold that much,
// as with a school's month, it uses what the member saved under askAs, and otherwise asks them.
func dateDetail(q answers.Question, part, date, askAs string, facts []answers.Fact) verdict {
	month, year, _ := parseDate(date)
	value := year
	if part == "month" {
		value = month
	}
	if value == "" {
		for _, fact := range facts {
			if normal(fact.Question) == normal(askAs) {
				value = strings.TrimSpace(fact.Answer)
			}
		}
	}
	if value == "" {
		if q.Required {
			return verdict{decision: askMember, why: "Your résumé does not say.", askAs: askAs}
		}
		return verdict{decision: leaveOut}
	}
	if q.Kind != answers.KindChoice {
		return exact(value)
	}
	// Forms word months in full or short: the first three letters tell them apart.
	for _, option := range q.Options {
		have, want := normal(option), normal(value)
		if have == want || (len(have) >= 3 && len(want) >= 3 && have[:3] == want[:3]) {
			return exact(option)
		}
	}
	if q.Required {
		return verdict{decision: askMember, why: "What you saved is not one of this form's choices.", askAs: askAs}
	}
	return verdict{decision: leaveOut}
}

// closestDegree matches "Bachelor of Science" to the form's own wording of it. It only ever
// uses what the résumé states: a Master of Science is never a form's first "Master" on the
// list, which may be an MBA, and a level not found is not guessed at.
func closestDegree(options []string, value string) (string, bool) {
	if option, ok := optionFor(options, value); ok {
		return option, true
	}
	have := normal(value)
	// The form's wording that has the résumé's in it, as in "Master of Science (M.S.)".
	for _, option := range options {
		if strings.Contains(normal(option), have) {
			return option, true
		}
	}
	isMBA := func(text string) bool {
		text = normal(text)
		return strings.Contains(text, "business administration") || strings.Contains(text, "mba") || strings.Contains(text, "m.b.a")
	}
	if isMBA(value) {
		for _, option := range options {
			if isMBA(option) {
				return option, true
			}
		}
		return "", false
	}
	for _, level := range [][]string{{"phd", "ph.d", "doctor"}, {"master", "m.s."}, {"bachelor", "b.s.", "b.a."}, {"associate"}} {
		isLevel := false
		for _, word := range level {
			isLevel = isLevel || strings.Contains(have, word)
		}
		if !isLevel {
			continue
		}
		// The plain name of the level, like "Master's Degree", says least beyond the résumé.
		var general, other string
		for _, option := range options {
			text := normal(option)
			if isMBA(text) {
				continue
			}
			for _, word := range level {
				if !strings.Contains(text, word) {
					continue
				}
				if strings.Contains(text, "degree") && general == "" {
					general = option
				} else if other == "" {
					other = option
				}
			}
		}
		if general != "" {
			return general, true
		}
		if other != "" && !strings.Contains(normal(other), " of ") {
			return other, true
		}
	}
	return "", false
}

var (
	humanOption   = regexp.MustCompile(`(?i)\b(i am|i'm|im) (a |an )?(human|real person|person|robot|bot|ai\b|automated)|\bhuman being\b|\bnot a (robot|bot)\b|\bai (agent|assistant|bot)\b`)
	humanQuestion = regexp.MustCompile(`(?i)\b(are you|you are)\s+(a |an )?(human being|human|robot|bot|real person)\b`)
	heardQuestion = regexp.MustCompile(`(?i)\bhow did you (hear|find|learn|come across)\b|\bwhere did you (hear|find|see|learn)\b|\bhear about (this|the|us)\b`)
	jobSiteOption = regexp.MustCompile(`(?i)\b(job ?board|job ?site|job ?search|online|internet|social media)\b`)
)

// asksIfHuman finds a form checking whether a person is filling it in. An automated agent
// cannot truthfully say so, in the same way it does not get past a CAPTCHA.
func asksIfHuman(q answers.Question) bool {
	if humanQuestion.MatchString(q.Label) {
		return true
	}
	for _, option := range q.Options {
		if humanOption.MatchString(option) {
			return true
		}
	}
	return false
}

// heardAbout answers how the member heard about a job: LinkedIn wherever the form allows it,
// as the team has chosen. A list without it gets the nearest kind of site, or goes to the model.
func heardAbout(q answers.Question) (verdict, bool) {
	if !heardQuestion.MatchString(q.Label) {
		return verdict{}, false
	}
	switch q.Kind {
	case answers.KindText, answers.KindLongText:
		return exact("LinkedIn"), true
	case answers.KindChoice, answers.KindMultiChoice:
		for _, wanted := range []*regexp.Regexp{regexp.MustCompile(`(?i)linked\s?in`), jobSiteOption} {
			for _, option := range q.Options {
				if wanted.MatchString(option) {
					return exact(option), true
				}
			}
		}
	}
	return verdict{}, false
}

// neutral finds the choices that say nothing, which the model is not offered: with those gone,
// it either picks a real answer or says it cannot.
var neutral = regexp.MustCompile(`(?i)^\s*(other\b.*|prefer not.*|i prefer not.*|decline.*|i decline.*|n/?a\b.*|not applicable\b.*|no preference\b.*|not sure\b.*|unsure\b.*|neutral\b.*|no answer\b.*|i don'?t wish.*|i do not wish.*|rather not.*|.*self-?describe.*)\s*$`)

// definiteOptions leaves out the neutral choices. If that would leave nothing, it leaves them.
func definiteOptions(options []string) []string {
	kept := make([]string, 0, len(options))
	for _, option := range options {
		if !neutral.MatchString(option) {
			kept = append(kept, option)
		}
	}
	if len(kept) == 0 {
		return options
	}
	return kept
}

var (
	affirmative = regexp.MustCompile(`(?i)\b(agree|acknowledge|accept|consent|understand|confirm|yes)\b`)
	negative    = regexp.MustCompile(`(?i)\b(disagree|decline|no|not|don'?t|do not)\b`)
)

// agreed ticks a required statement for a member who has said the agent may.
func agreed(q answers.Question) (verdict, bool) {
	if q.Kind == answers.KindCheckbox {
		return exact("yes"), true
	}
	if q.Kind != answers.KindChoice && q.Kind != answers.KindMultiChoice {
		return verdict{}, false
	}
	for _, option := range q.Options {
		if affirmative.MatchString(option) && !negative.MatchString(option) {
			return exact(option), true
		}
	}
	return verdict{}, false
}

// demographicFacts are the voluntary questions a member can answer on the Auto apply page.
// They are copied into forms by these rules alone, and are never sent to the model.
var demographicFacts = map[string]bool{"gender": true, "race": true, "hispanic or latino": true, "veteran status": true, "disability status": true, "lgbtq+": true}

func demographicFact(facts []answers.Fact, name string) string {
	for _, fact := range facts {
		if normal(fact.Question) == name {
			return normal(fact.Answer)
		}
	}
	return ""
}

// asksGenderByOptions finds a gender question worded only as "I identify as".
func asksGenderByOptions(q answers.Question) bool {
	if !strings.Contains(normal(q.Label), "identify as") {
		return false
	}
	for _, option := range q.Options {
		if regexp.MustCompile(`(?i)^(female|woman|male|man)\b`).MatchString(option) {
			return true
		}
	}
	return false
}

// asksTransgenderByOptions finds that question worded only as "I identify as".
func asksTransgenderByOptions(q answers.Question) bool {
	for _, option := range q.Options {
		if regexp.MustCompile(`(?i)\b(cisgender|transgender)\b`).MatchString(option) {
			return true
		}
	}
	return false
}

// agreesInItsChoices finds a statement that shows only in its choices, as with "GDPR".
func agreesInItsChoices(q answers.Question) bool {
	if q.Kind != answers.KindChoice && q.Kind != answers.KindMultiChoice {
		return false
	}
	return len(q.Options) > 0 && len(q.Options) <= 3 && regexp.MustCompile(`(?i)\b(i agree|i acknowledge|acknowledge|i consent|i accept)\b`).MatchString(strings.Join(q.Options, " | "))
}

var (
	straightOption = regexp.MustCompile(`(?i)\b(heterosexual|straight)\b`)
	noOption       = regexp.MustCompile(`(?i)^no\b`)
	yesOption      = regexp.MustCompile(`(?i)^yes\b`)
	lacksIt        = regexp.MustCompile(`(?i)\b(do not|don'?t)\s+have\b`)
	notVet         = regexp.MustCompile(`(?i)\bnot\b.*\bveteran\b|\bnever served\b`)
	isVet          = regexp.MustCompile(`(?i)\b(i am|identify as)\b.*\bveteran\b`)
	// Forms also ask this as a list holding "Not Hispanic or Latino".
	notHispanic = regexp.MustCompile(`(?i)\bnot\b.*\b(hispanic|latin[oax]+)\b`)
	isHispanic  = regexp.MustCompile(`(?i)\b(hispanic|latin[oax]+)\b`)
)

// demographicChoice finds the form's wording of what the member saved. Forms word these in
// many ways, so each topic is matched by what its options mean. With no clear match the form's
// way of declining is used instead: a choice here is never a guess.
func demographicChoice(q answers.Question, facts []answers.Fact) (string, bool) {
	var fits func(option string) bool
	label := normal(q.Label)
	gender := demographicFact(facts, "gender")
	notLGBTQ := demographicFact(facts, "lgbtq+") == "no"
	switch {
	case asksGenderByOptions(q):
		fits = genderFits(gender)
		if fits == nil {
			return "", false
		}
	case strings.Contains(label, "transgender") || asksTransgenderByOptions(q):
		// Saying no to LGBTQ+ already says no to this.
		if !notLGBTQ {
			return "", false
		}
		fits = func(option string) bool {
			return noOption.MatchString(option) || regexp.MustCompile(`(?i)\bcisgender\b`).MatchString(option)
		}
	case strings.Contains(label, "orientation"):
		if !notLGBTQ {
			return "", false
		}
		fits = straightOption.MatchString
	case strings.Contains(label, "pronoun"):
		// With a gender saved and no to LGBTQ+, the usual pronouns follow. Otherwise they are
		// the member's own to give.
		if !notLGBTQ {
			return "", false
		}
		switch gender {
		case "female":
			fits = regexp.MustCompile(`(?i)\bshe\b`).MatchString
		case "male":
			fits = regexp.MustCompile(`(?i)\bhe\b`).MatchString
		default:
			return "", false
		}
	case strings.Contains(label, "lgbt"):
		saved := demographicFact(facts, "lgbtq+")
		if saved == "" {
			return "", false
		}
		fits = func(option string) bool {
			if saved == "yes" {
				return yesOption.MatchString(option)
			}
			return saved == "no" && noOption.MatchString(option)
		}
	case strings.Contains(label, "veteran") || strings.Contains(label, "military"):
		saved := demographicFact(facts, "veteran status")
		switch {
		case saved == "":
			return "", false
		case strings.Contains(saved, "not"):
			fits = func(option string) bool { return notVet.MatchString(option) || noOption.MatchString(option) }
		default:
			fits = func(option string) bool {
				return isVet.MatchString(option) && !notVet.MatchString(option) || yesOption.MatchString(option)
			}
		}
	case strings.Contains(label, "disab"):
		saved := demographicFact(facts, "disability status")
		switch saved {
		case "no":
			fits = func(option string) bool { return noOption.MatchString(option) || lacksIt.MatchString(option) }
		case "yes":
			fits = func(option string) bool { return yesOption.MatchString(option) }
		default:
			return "", false
		}
	case strings.Contains(label, "hispanic") || strings.Contains(label, "latin"):
		fits = hispanicFits(demographicFact(facts, "hispanic or latino"))
		if fits == nil {
			return "", false
		}
	case strings.Contains(label, "gender"):
		fits = genderFits(gender)
		if fits == nil {
			return "", false
		}
	case strings.Contains(label, "race") || strings.Contains(label, "racial") || strings.Contains(label, "ethnic"):
		saved := demographicFact(facts, "race")
		// A list about ethnicity alone holds only "Hispanic or Latino" and "Not Hispanic or Latino".
		if option, ok := ethnicityList(q.Options, demographicFact(facts, "hispanic or latino")); ok {
			return option, true
		}
		words := strings.Fields(saved)
		if len(words) == 0 {
			return "", false
		}
		word := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(words[0]) + `\b`)
		fits = word.MatchString
	default:
		return "", false
	}
	for _, option := range q.Options {
		if !declines.MatchString(option) && fits(option) {
			return option, true
		}
	}
	return "", false
}

func genderFits(saved string) func(string) bool {
	switch saved {
	case "female":
		return regexp.MustCompile(`(?i)\b(female|woman)\b`).MatchString
	case "male":
		return regexp.MustCompile(`(?i)\b(male|man)\b`).MatchString
	case "non-binary":
		return regexp.MustCompile(`(?i)\bnon-?\s?binary\b`).MatchString
	}
	return nil
}

func hispanicFits(saved string) func(string) bool {
	switch saved {
	case "no":
		return func(option string) bool { return noOption.MatchString(option) || notHispanic.MatchString(option) }
	case "yes":
		return func(option string) bool {
			return yesOption.MatchString(option) || (isHispanic.MatchString(option) && !notHispanic.MatchString(option))
		}
	}
	return nil
}

// ethnicityList answers a question whose every real option is about being Hispanic or not.
func ethnicityList(options []string, saved string) (string, bool) {
	fits := hispanicFits(saved)
	if fits == nil {
		return "", false
	}
	for _, option := range options {
		if !declines.MatchString(option) && !isHispanic.MatchString(option) {
			return "", false
		}
	}
	for _, option := range options {
		if !declines.MatchString(option) && fits(option) {
			return option, true
		}
	}
	return "", false
}

// declined takes the form's own way of not answering a demographic question. These are
// never worked out from a résumé: only the member's saved answer goes in one.
func declined(q answers.Question) verdict {
	for _, option := range q.Options {
		if declines.MatchString(option) {
			return exact(option)
		}
	}
	if q.Required {
		return member("This form has no way to decline this question, so it is yours to answer.")
	}
	return verdict{decision: leaveOut}
}
