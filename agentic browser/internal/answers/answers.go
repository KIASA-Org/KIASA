// Package answers is what the KIASA Browser and the model server say to each other. The
// browser sends every question a form asks, with the job and the member's résumé and
// details. The server sends back the answers, and says which ones the member has to give.
package answers

import "encoding/json"

// The kinds of question a form can ask.
const (
	KindText        = "text"
	KindLongText    = "long_text"
	KindChoice      = "choice"       // pick one of Options
	KindMultiChoice = "multi_choice" // pick any of Options
	KindSearch      = "search"       // type to find a choice, as with a school or a city
	KindCheckbox    = "checkbox"     // one box, as with a consent
	KindFile        = "file"         // the browser attaches these itself
)

// Question is one thing an application form asks.
type Question struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	Label    string   `json:"label"`
	Required bool     `json:"required"`
	Hint     string   `json:"hint,omitempty"`
	Options  []string `json:"options,omitempty"`
}

// Job is the posting being applied to.
type Job struct {
	Company     string `json:"company,omitempty"`
	Title       string `json:"title,omitempty"`
	Location    string `json:"location,omitempty"`
	Description string `json:"description,omitempty"`
}

// Fact is something the member has said about themselves, as in their work authorization,
// or their answer to a question a form asked before.
type Fact struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// Info is what the member entered about themselves on the Auto apply page.
type Info struct {
	FirstName string `json:"first_name,omitempty"`
	LastName  string `json:"last_name,omitempty"`
	Email     string `json:"email,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Address   string `json:"address,omitempty"`
	State     string `json:"state,omitempty"`
	Zip       string `json:"zip,omitempty"`
	Country   string `json:"country,omitempty"`
	City      string `json:"city,omitempty"`
	LinkedIn  string `json:"linkedin,omitempty"`
	Website   string `json:"website,omitempty"`
	GitHub    string `json:"github,omitempty"`
	// Career is more about their career than a résumé holds, in their own words.
	Career string `json:"career,omitempty"`
	// AgreeForMe is "yes" when the member has said the agent may tick the statements a form
	// requires on their behalf. It is their choice, off until they make it.
	AgreeForMe string `json:"agree_for_me,omitempty"`
	Facts      []Fact `json:"facts,omitempty"`
}

// Request asks for the answers to one job's questions.
type Request struct {
	Job       Job             `json:"job"`
	Resume    json.RawMessage `json:"resume"`
	Info      Info            `json:"info"`
	Questions []Question      `json:"questions"`
}

// Answer is the reply to one question. For a search, Values holds what to look for, best first.
type Answer struct {
	ID     string   `json:"id"`
	Values []string `json:"values"`
}

// Ask is a question only the member can answer.
type Ask struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Why     string   `json:"why"`
	Kind    string   `json:"kind,omitempty"`
	Options []string `json:"options,omitempty"`
}

// Reply is everything the server has to say about a job's questions.
type Reply struct {
	Answers []Answer `json:"answers"`
	Asks    []Ask    `json:"asks"`
	// Stop says the agent should not go on with this form at all, and why.
	Stop string `json:"stop,omitempty"`
}

// The states of a request, as the browser sees them while it waits.
const (
	StateQueued  = "queued"
	StateWorking = "working"
	StateDone    = "done"
	StateFailed  = "failed"
)

// Progress is how a request stands.
type Progress struct {
	Ticket string `json:"ticket"`
	State  string `json:"state"`
	// Position is how many requests are ahead of this one.
	Position int    `json:"position"`
	Reply    *Reply `json:"reply,omitempty"`
	Error    string `json:"error,omitempty"`
}
