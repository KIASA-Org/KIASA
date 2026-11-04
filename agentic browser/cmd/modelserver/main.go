// Command modelserver is the KIASA Model Server. It runs on the PC with the model and
// answers job application questions for connected KIASA Browsers. Ollama stays reachable
// from this PC only: browsers reach this program, through the tunnel, and nothing else.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"stealth-app/internal/modelserver"
)

// defaultPublicKey is KIASA's public key, set when the program is built for this PC.
var defaultPublicKey = ""

func main() {
	listen := flag.String("listen", "127.0.0.1:8787", "where to listen: keep this on 127.0.0.1, the tunnel connects to it")
	ollama := flag.String("ollama", "http://127.0.0.1:11434", "where Ollama is, on this PC")
	model := flag.String("model", "qwen3:8b", "the model to use")
	workers := flag.Int("workers", 1, "how many requests the model works on at once")
	contextSize := flag.Int("context", 8192, "how much text, in tokens, the model holds at once")
	database := flag.String("database", "https://lghgwvqgigbmcnxbhdwi.supabase.co", "KIASA's database, which checks each browser's key")
	publicKey := flag.String("public-key", firstOf(os.Getenv("KIASA_PUBLIC_KEY"), defaultPublicKey), "KIASA's public key, the one every page of the site has")
	address := flag.String("address", "", "where browsers can reach this server, which it tells KIASA")
	keyFile := flag.String("key-file", filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "model-server-key.txt"), "this server's own key, for telling KIASA where it is")
	tunnel := flag.String("tunnel", "", "cloudflared, to open a tunnel and tell KIASA its address")
	flag.Parse()
	closeLog := keepLog()
	defer closeLog()

	if *publicKey == "" {
		log.Fatal("KIASA's public key is needed: set KIASA_PUBLIC_KEY or use -public-key.")
	}

	client := &http.Client{}
	server := modelserver.New(modelserver.Config{
		Model: &modelserver.Model{
			Address:     *ollama,
			Name:        *model,
			Prompt:      modelserver.Prompt(),
			Client:      client,
			ContextSize: *contextSize,
		},
		Check:   checkWithKIASA(*database, *publicKey),
		Workers: *workers,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go server.Run(ctx)

	// How the model is, said at once: a window that opens and looks fine should be fine.
	switch health := server.HealthNow(ctx); {
	case !health.Ollama:
		log.Println("[!] Ollama is not answering. Start Ollama: browsers will wait until it is back.")
	case !health.Installed:
		log.Printf("[!] Ollama does not have %s. Run: ollama pull %s\n", *model, *model)
	default:
		log.Printf("[+] Ollama is running and has %s.\n", *model)
	}

	current := &whereTo{wake: make(chan struct{}, 1)}
	current.set(*address)
	if *tunnel != "" {
		go modelserver.RunTunnel(ctx, *tunnel, "http://"+*listen, func(found string) {
			if found != "" {
				log.Printf("[+] Browsers can reach this server at %s\n", found)
			}
			current.set(found)
		})
	}
	if *address != "" || *tunnel != "" {
		key, err := os.ReadFile(*keyFile)
		if err != nil {
			log.Fatalf("[-] This server's key could not be read: %v", err)
		}
		go tellKIASA(ctx, *database, *publicKey, strings.TrimSpace(string(key)), current, server)
	}

	front := &http.Server{
		Addr:              *listen,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		front.Shutdown(shut)
	}()
	log.Printf("[+] KIASA Model Server is ready at http://%s, with %s.\n", *listen, *model)
	if err := front.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[-] Could not start: %v", err)
	}
}

// whereTo is where browsers can reach this server right now, which a new tunnel changes.
type whereTo struct {
	mu      sync.Mutex
	address string
	wake    chan struct{}
}

func (w *whereTo) set(address string) {
	w.mu.Lock()
	w.address = address
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *whereTo) get() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.address
}

// tellKIASA says where this server is every so often, which is also how browsers and the admins'
// Model tab know it is on. A new address is told at once.
func tellKIASA(ctx context.Context, database, publicKey, key string, current *whereTo, server *modelserver.Server) {
	client := &http.Client{Timeout: 15 * time.Second}
	told := ""
	for {
		if address := current.get(); address != "" {
			err := report(ctx, client, database, publicKey, key, address, server)
			switch {
			case err != nil && ctx.Err() == nil:
				log.Printf("[!] Could not tell KIASA where this server is: %v\n", err)
				told = ""
			case err == nil && told != address:
				log.Printf("[+] KIASA has this server's address. Keep this window open: closing it turns the model off for the team.\n")
				told = address
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-current.wake:
		case <-time.After(reportEvery):
		}
	}
}

func firstOf(texts ...string) string {
	for _, text := range texts {
		if text != "" {
			return text
		}
	}
	return ""
}

// keepLog also writes the log to a file. It never holds a question, an answer or a résumé.
func keepLog() func() {
	folder := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "logs")
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return func() {}
	}
	path := filepath.Join(folder, "model-server.log")
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(path); err == nil && info.Size() > 1<<20 {
		flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	}
	file, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return func() {}
	}
	log.SetOutput(io.MultiWriter(os.Stderr, file))
	return func() { file.Close() }
}

// reportEvery is how fresh the admins' Model server tab is.
const reportEvery = 20 * time.Second

func report(ctx context.Context, client *http.Client, database, publicKey, key, address string, server *modelserver.Server) error {
	body, err := json.Marshal(map[string]any{
		"server_key": key, "address": address, "waiting": server.Waiting(),
		"health": server.HealthNow(ctx), "connected": server.ConnectedNow(),
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(database, "/")+"/rest/v1/rpc/model_server_report", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", publicKey)
	req.Header.Set("Authorization", "Bearer "+publicKey)
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("KIASA answered with status %d", res.StatusCode)
	}
	return nil
}

// checkWithKIASA asks KIASA which member a browser's key belongs to.
func checkWithKIASA(database, publicKey string) func(context.Context, string) (string, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	return func(ctx context.Context, key string) (string, error) {
		body, err := json.Marshal(map[string]string{"agent_key": key})
		if err != nil {
			return "", err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(database, "/")+"/rest/v1/rpc/browser_agent_who", strings.NewReader(string(body)))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("apikey", publicKey)
		req.Header.Set("Authorization", "Bearer "+publicKey)
		res, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer res.Body.Close()
		reply, err := io.ReadAll(io.LimitReader(res.Body, 8<<10))
		if err != nil {
			return "", err
		}
		if strings.Contains(string(reply), `"28000"`) {
			return "", modelserver.ErrRefused
		}
		if res.StatusCode != http.StatusOK {
			return "", fmt.Errorf("KIASA answered with status %d", res.StatusCode)
		}
		var member string
		if err := json.Unmarshal(reply, &member); err != nil {
			return "", err
		}
		return member, nil
	}
}
