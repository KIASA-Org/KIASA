// Package modelserver answers job application questions for KIASA Browsers. It runs on the
// PC that has the model, in front of Ollama: it checks each browser's key, keeps a queue,
// and keeps nothing it was sent once the answers have been fetched.
package modelserver

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"strings"
)

// masterPrompt is the owner's own prompt, used word for word. It must not be edited here:
// a change to it is the owner's, and also changes promptChecksum.
//
//go:embed prompts/MASTER_PROMPT.md
var masterPrompt string

// promptChecksum is the prompt as it was given. A test compares the two.
const promptChecksum = "fbc22a5a2f536005b6901ec71d43174847507790b0f277b749d0505bacfb5a2a"

// Prompt returns the prompt as it was given. Git may change how a checkout on Windows
// ends its lines, and that is the only thing taken back out.
func Prompt() string {
	return strings.ReplaceAll(masterPrompt, "\r\n", "\n")
}

func checksum(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
