// Command gmailtry proves the Gmail connection against a real inbox, for testing. It opens Google's
// Allow page, keeps the access sealed, and reads the newest verification code from a hiring system.
// It reads mail only and sends nothing. It needs the Google app's client file at
// %LOCALAPPDATA%\KIASA\google\client_secret.json.
//
// Usage: go run ./tools/gmailtry            (connect if needed, then read the latest code)
//
//	go run ./tools/gmailtry -hours 24  (look back further)
//	go run ./tools/gmailtry -forget    (disconnect)
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"stealth-app/internal/gmail"
	"stealth-app/internal/settings"
)

type sealer struct{}

func (sealer) Seal(b []byte) ([]byte, error)   { return settings.Seal(b) }
func (sealer) Unseal(b []byte) ([]byte, error) { return settings.Unseal(b) }

func main() {
	hours := flag.Int("hours", 6, "how many hours back to look for a code")
	forget := flag.Bool("forget", false, "disconnect Gmail")
	flag.Parse()

	home := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA")
	clientID, clientSecret, err := readClient(filepath.Join(home, "google", "client_secret.json"))
	if err != nil {
		log.Fatalf("Could not read the Google app's client file: %v", err)
	}
	store := gmail.SealedFile{Path: filepath.Join(home, "gmail-token.bin"), Sealer: sealer{}}
	if *forget {
		if err := store.Forget(); err != nil {
			log.Fatal(err)
		}
		fmt.Println("Gmail disconnected.")
		return
	}
	client := gmail.New(gmail.Config{
		ClientID: clientID, ClientSecret: clientSecret,
		Transport: gmail.HTTPTransport(&http.Client{Timeout: 30 * time.Second}),
		Store:     store,
	})

	if !client.Connected() {
		fmt.Println("Opening Google's Allow page in your browser. Sign in as a test user and click Allow...")
		email, err := client.Connect(openInBrowser, "", 10*time.Minute)
		if err != nil {
			log.Fatalf("Could not connect Gmail: %v", err)
		}
		fmt.Printf("Connected: %s\n", email)
	} else {
		email, err := client.Profile()
		if err != nil {
			log.Fatalf("The saved access did not work: %v", err)
		}
		fmt.Printf("Already connected: %s\n", email)
	}

	fmt.Printf("Looking for a verification code in the last %d hours...\n", *hours)
	found, err := client.LatestCode(*hours)
	if err != nil {
		log.Fatalf("Could not read mail: %v", err)
	}
	if found == nil {
		fmt.Println("No verification code from a hiring system was found in that time. Trigger one on a job form and try again.")
		return
	}
	fmt.Printf("Found code %q\n  from:    %s\n  subject: %s\n", found.Code, found.From, found.Subject)
}

func readClient(path string) (id, secret string, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	var file struct {
		Installed struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
		} `json:"installed"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return "", "", err
	}
	if file.Installed.ClientID == "" {
		return "", "", fmt.Errorf("no client_id in %s", path)
	}
	return file.Installed.ClientID, file.Installed.ClientSecret, nil
}

func openInBrowser(address string) error {
	fmt.Println("ALLOW_URL " + address)
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address).Start()
}
