// Command signrelease signs a KIASA Browser release, which is what lets members' browsers install
// it by themselves. The private key stays on this PC: it is never in this repository, and whoever
// holds it can put a program on every member's PC, so keep it safe and keep a backup.
//
// Make the key once:   go run ./tools/signrelease -new-key
// Sign a release:      go run ./tools/signrelease -version 1.3.0 -url <address of the setup> -file <setup> -out latest.json
// Put one back:        the same, with -rollback, for the older version's setup
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"stealth-app/internal/brand"
	"stealth-app/internal/update"
)

func main() {
	defaultKey := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "release-signing-key.txt")
	newKey := flag.Bool("new-key", false, "make the release key, once")
	keyFile := flag.String("key", defaultKey, "the private key's file")
	publicKey := flag.String("public", brand.UpdateKey, "the public key browsers hold, to check the signature against")
	version := flag.String("version", "", "the version, such as 1.3.0")
	address := flag.String("url", "", "where the setup will be downloaded from")
	file := flag.String("file", "", "the setup program")
	rollback := flag.Bool("rollback", false, "this puts an older version back on purpose")
	out := flag.String("out", "", "where to write the manifest")
	flag.Parse()

	if *newKey {
		makeKey(*keyFile)
		return
	}
	if *version == "" || *address == "" || *file == "" || *out == "" {
		log.Fatal("Needs -version, -url, -file and -out.")
	}
	raw, err := os.ReadFile(*keyFile)
	if err != nil {
		log.Fatalf("The release key could not be read: %v", err)
	}
	seed, err := base64.StdEncoding.DecodeString(string(trim(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		log.Fatal("The release key is damaged.")
	}
	setup, err := os.ReadFile(*file)
	if err != nil {
		log.Fatal(err)
	}
	sum := sha256.Sum256(setup)
	manifest := update.Manifest{Version: *version, URL: *address, SHA256: hex.EncodeToString(sum[:]), Rollback: *rollback}
	manifest.Sign(ed25519.NewKeyFromSeed(seed))
	// Browsers hold the public key: signing with anything else would help no one.
	if err := manifest.Verify(*publicKey); err != nil {
		log.Fatalf("This key does not match the one browsers hold: %v", err)
	}
	packed, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, append(packed, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Signed version %s: %s\n", *version, *out)
}

func makeKey(path string) {
	if _, err := os.Stat(path); err == nil {
		log.Fatalf("There is a release key already, at %s. Replacing it would stop browsers updating, so it was left alone.", path)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(private.Seed())), 0o600); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Made the release key: %s\nBack it up somewhere safe.\nPublic key for brand.UpdateKey: %s\n", path, base64.StdEncoding.EncodeToString(public))
}

func trim(data []byte) []byte {
	for len(data) > 0 && (data[len(data)-1] == '\n' || data[len(data)-1] == '\r' || data[len(data)-1] == ' ') {
		data = data[:len(data)-1]
	}
	return data
}
