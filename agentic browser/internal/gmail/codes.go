// Package gmail reads verification codes from the member's own Gmail, read-only, so the browser
// can finish an application that emails a code. It reaches Google through the browser's own tab,
// so the request leaves with the same address as the member's browsing, and it keeps the access
// sealed on this PC. It can only read mail: it cannot send, change or delete anything.
//
// This file is the part that does not touch Google at all: finding the code in an email, and
// working out which mail belongs to which application. It is ported from the owner's proven
// Job Applying Agent (gmail_codes.py), kept the same so codes are read the same way.
package gmail

import (
	"regexp"
	"strings"
)

// ATSDomains are the hiring systems that send the mail, from their own domain, not the employer's.
var ATSDomains = []string{"greenhouse", "lever", "myworkday", "workday", "icims", "ashbyhq", "smartrecruiters",
	"workable", "bamboohr", "rippling", "applytojob", "jazzhr", "taleo", "oracle", "successfactors",
	"jobvite", "adp", "paylocity", "ultipro", "ukg", "dayforce", "jobright"}

// genericWords are company-name words too common to tell one sender from another.
var genericWords = map[string]bool{"inc": true, "llc": true, "ltd": true, "corp": true, "corporation": true,
	"the": true, "company": true, "systems": true, "technologies": true, "technology": true, "tech": true,
	"group": true, "solutions": true, "services": true, "global": true, "international": true, "labs": true,
	"holdings": true, "software": true, "networks": true, "data": true, "health": true, "financial": true,
	"partners": true, "and": true}

const codeWords = `(?:code|passcode|pass code|pin|otp|one[- ]time|verification|verify|security|sign[- ]in|login)`

// tokenCore is what a code looks like: 4-8 letters/digits, or two short groups with a dash. It has
// no "must contain a digit" rule, because Go's regexp has no lookahead; that is checked after.
const tokenCore = `[A-Za-z0-9]{3,4}-?[A-Za-z0-9]{3,4}|[0-9]{4,8}|[A-Za-z0-9]{4,8}`

var (
	manySpaces = regexp.MustCompile(`[ \t]+`)
	aYear      = regexp.MustCompile(`^(?:19|20)\d\d$`)
	hasDigit   = regexp.MustCompile(`\d`)
	oneWord    = regexp.MustCompile(`^[A-Za-z][a-z]+$`)
	tokenAlone = regexp.MustCompile(`^[A-Za-z0-9]{6,10}$`)
	aCodeWord  = regexp.MustCompile(`(?i)` + codeWords)
	// A token the right shape for a code. Whether it really is one (has a digit, is not a year) is
	// checked after, because Go's regexp cannot require the digit inside the pattern, and without
	// that the match would stop on the word "code" itself.
	tokenHere = regexp.MustCompile(`\b(?:` + tokenCore + `)\b`)
	codeLine  = regexp.MustCompile(`(?m)^\s*(` + tokenCore + `)\s*$`)
)

// isCode says a token really is a code: it has a digit, and is not a year.
func isCode(token string) bool {
	return hasDigit.MatchString(token) && !aYear.MatchString(token)
}

// sameLine returns the part of text up to the next newline.
func sameLine(text string) string {
	if at := strings.IndexByte(text, '\n'); at >= 0 {
		return text[:at]
	}
	return text
}

// FindCode returns the verification code in an email, or "" if there is none. The code is returned
// exactly as written, because some (Greenhouse's) are case-sensitive.
func FindCode(subject, text string) string {
	blob := subject + "\n" + manySpaces.ReplaceAllString(text, " ")
	words := aCodeWord.FindAllStringIndex(blob, -1)
	// Just after a code word, on the same line: "code: 482913", "security code is 482913".
	for _, at := range words {
		window := sameLine(blob[at[1]:])
		if len(window) > 80 {
			window = window[:80]
		}
		for _, token := range tokenHere.FindAllString(window, -1) {
			if isCode(token) {
				return token
			}
		}
	}
	// Just before a code word, on the same line: "482913 is your code".
	for _, at := range words {
		start := strings.LastIndexByte(blob[:at[0]], '\n') + 1
		window := blob[start:at[0]]
		if len(window) > 40 {
			window = window[len(window)-40:]
		}
		tokens := tokenHere.FindAllString(window, -1)
		for i := len(tokens) - 1; i >= 0; i-- {
			if isCode(tokens[i]) {
				return tokens[i]
			}
		}
	}
	// The code alone on its own line.
	for _, match := range codeLine.FindAllStringSubmatch(blob, -1) {
		if isCode(match[1]) {
			return match[1]
		}
	}
	// A code with no digit in it (Greenhouse's "POjHJiwL"): a 6-10 letter/digit token, alone on its
	// line, in the few lines after a line that talks about the code, and not an ordinary word.
	var lines []string
	for _, line := range strings.Split(blob, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	for i, line := range lines {
		if !aCodeWord.MatchString(line) {
			continue
		}
		for j := i + 1; j < len(lines) && j <= i+3; j++ {
			if tokenAlone.MatchString(lines[j]) && !oneWord.MatchString(lines[j]) {
				return lines[j]
			}
		}
	}
	return ""
}

var notPartOfHost = regexp.MustCompile(`[.\-]`)
var lettersDigits = regexp.MustCompile(`[a-z0-9]+`)
var workdayPart = regexp.MustCompile(`^wd\d+$`)

// hostSkip are host pieces that mark no particular sender.
var hostSkip = map[string]bool{"www": true, "com": true, "io": true, "co": true, "jobs": true, "careers": true,
	"job": true, "boards": true, "apply": true, "net": true, "org": true, "ai": true}

// SiteHints are the words that mark mail as belonging to one application: the job site's own name,
// its hiring system, and the company. Used to tell one application's code email from another's.
func SiteHints(host, company string) []string {
	host = strings.ToLower(host)
	seen := map[string]bool{}
	var hints []string
	add := func(word string) {
		if word != "" && !seen[word] {
			seen[word] = true
			hints = append(hints, word)
		}
	}
	for _, part := range notPartOfHost.Split(host, -1) {
		if len(part) > 2 && !hostSkip[part] && !workdayPart.MatchString(part) {
			add(part)
		}
	}
	for _, ats := range ATSDomains {
		if strings.Contains(host, ats) {
			add(ats)
		}
	}
	for _, word := range lettersDigits.FindAllString(strings.ToLower(company), -1) {
		if len(word) > 2 && !genericWords[word] {
			add(word)
		}
	}
	return hints
}

// FromATS says whether a sender address is one of the hiring systems.
func FromATS(from string) bool {
	from = strings.ToLower(from)
	at := strings.LastIndex(from, "@")
	if at < 0 {
		return false
	}
	domain := strings.TrimRight(from[at+1:], ">) ")
	for _, ats := range ATSDomains {
		if strings.Contains(domain, ats) {
			return true
		}
	}
	return false
}

// Belongs says whether a code email belongs to this application: it is from a hiring system, or its
// sender or subject carries one of the site's hint words. A mail matching nothing is left alone, so
// another application's code is never typed into this one.
func Belongs(hints []string, from, subject string) bool {
	if FromATS(from) {
		return true
	}
	haystack := strings.ToLower(from + " " + subject)
	for _, hint := range hints {
		if strings.Contains(haystack, hint) {
			return true
		}
	}
	return false
}
