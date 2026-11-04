package modelserver

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var tunnelAddressIn = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// tunnelArgs is how cloudflared is asked for a tunnel to this server. A quick tunnel needs no
// Cloudflare account, and its address changes each time it starts.
var tunnelArgs = func(target string) []string {
	return []string{"tunnel", "--no-autoupdate", "--url", target}
}

// tunnelRestartAfter is how long it waits before opening a tunnel that closed.
var tunnelRestartAfter = 5 * time.Second

// tunnelAddress finds the tunnel's address in a line cloudflared wrote. Cloudflare's own service
// is named in those lines too, and is not it.
func tunnelAddress(line string) string {
	for _, found := range tunnelAddressIn.FindAllString(line, -1) {
		if found != "https://api.trycloudflare.com" {
			return found
		}
	}
	return ""
}

// RunTunnel keeps a tunnel open to the target until ctx ends, opening a new one if it closes.
// Each new address goes to onAddress, and an empty one means there is none for now.
func RunTunnel(ctx context.Context, cloudflared, target string, onAddress func(string)) {
	for ctx.Err() == nil {
		err := tunnelOnce(ctx, cloudflared, target, onAddress)
		onAddress("")
		if ctx.Err() != nil {
			return
		}
		log.Printf("[!] The tunnel closed (%v). Opening a new one.\n", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(tunnelRestartAfter):
		}
	}
}

func tunnelOnce(ctx context.Context, cloudflared, target string, onAddress func(string)) error {
	run := exec.CommandContext(ctx, cloudflared, tunnelArgs(target)...)
	output, err := run.StderrPipe()
	if err != nil {
		return err
	}
	if err := run.Start(); err != nil {
		return fmt.Errorf("could not start cloudflared: %w", err)
	}
	found := false
	reader := bufio.NewReader(output)
	for {
		line, err := reader.ReadString('\n')
		if address := tunnelAddress(line); address != "" && !found {
			found = true
			onAddress(address)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !strings.Contains(err.Error(), "file already closed") {
				log.Printf("[!] Could not read the tunnel's messages: %v\n", err)
			}
			break
		}
	}
	return run.Wait()
}
