package gmail

import (
	"strings"
	"testing"
)

func TestFindCode(t *testing.T) {
	cases := []struct {
		name, subject, text, want string
	}{
		{"code is", "Your code", "Your verification code is 482913. It expires in 10 minutes.", "482913"},
		{"code colon", "Sign in", "Security code: 019283", "019283"},
		{"code before words", "Verify", "482913 is your one-time code.", "482913"},
		{"eight digits", "Security code for your application to EarnIn", "Your security code is 01877123. Enter it to confirm.", "01877123"},
		{"alone on a line", "Confirmation", "Enter this verification code:\n736104\nThanks,", "736104"},
		{"a dash", "Verify", "Your login code is AB12-9XY3.", "AB12-9XY3"},
		{"greenhouse letters only", "Complete your application",
			"Copy and paste this code into the security code field to continue:\nPOjHJiwL\nThank you.", "POjHJiwL"},
		{"greenhouse mixed with digit on its line", "Security code", "Please use the code below:\nK7mQ2x\nIf you did not request this,", "K7mQ2x"},
		{"a year is not a code", "Graduated", "Verification of degree awarded in 2021 at the university.", ""},
		{"an ordinary word is not a code", "Welcome", "Thank you for verifying your email.\nWelcome\nTo the team.", ""},
		{"nothing", "Newsletter", "Here is our monthly update about jobs and careers.", ""},
		{"ignores an unrelated number far away", "News", "We have 500 open roles. Separately, your account was verified.", ""},
	}
	for _, c := range cases {
		if got := FindCode(c.subject, c.text); got != c.want {
			t.Errorf("%s: FindCode = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestFindCode_KeepsCaseExactly(t *testing.T) {
	// Greenhouse codes are case-sensitive, so the exact case must come back.
	got := FindCode("Security code", "Enter this code to continue:\naB3dEf\nThanks")
	if got != "aB3dEf" {
		t.Errorf("FindCode = %q, want aB3dEf", got)
	}
}

func TestSiteHints(t *testing.T) {
	hints := SiteHints("job-boards.greenhouse.io", "EarnIn Inc")
	has := func(word string) bool {
		for _, h := range hints {
			if h == word {
				return true
			}
		}
		return false
	}
	if !has("greenhouse") || !has("earnin") {
		t.Errorf("hints = %v, want greenhouse and earnin", hints)
	}
	for _, skip := range []string{"com", "io", "www", "jobs", "inc"} {
		if has(skip) {
			t.Errorf("hints should not include %q: %v", skip, hints)
		}
	}
}

func TestFromATS(t *testing.T) {
	cases := map[string]bool{
		"no-reply@greenhouse.io":              true,
		"Greenhouse <no-reply@greenhouse.io>": true,
		"notifications@hi.lever.co":           true,
		"jobs@acme.com":                       false,
		"not an address":                      false,
	}
	for from, want := range cases {
		if got := FromATS(from); got != want {
			t.Errorf("FromATS(%q) = %v, want %v", from, got, want)
		}
	}
}

func TestBelongs(t *testing.T) {
	hints := SiteHints("job-boards.greenhouse.io", "EarnIn")
	if !Belongs(hints, "no-reply@greenhouse.io", "Security code for EarnIn") {
		t.Error("a Greenhouse code email should belong")
	}
	if !Belongs(nil, "careers@us.greenhouse.io", "Your code") {
		t.Error("any hiring-system sender belongs, even with no hints")
	}
	if Belongs(hints, "no-reply@other-company.com", "Your Spotify login code") {
		t.Error("another service's code must not be taken for this application")
	}
	if !Belongs(hints, "jobs@mailer.example", "Welcome to EarnIn — your code") {
		t.Error("a subject naming the company belongs")
	}
}

func TestFindCode_DoesNotCrashOnOddInput(t *testing.T) {
	for _, text := range []string{"", "\n\n\n", strings.Repeat("code ", 5000), strings.Repeat("A1", 10000)} {
		FindCode("subject", text)
	}
}
