package single

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func TestSecondCopyWakesTheFirst(t *testing.T) {
	name := fmt.Sprintf(`Local\KIASA-test-%d`, os.Getpid())
	wake, first := Claim(name)
	if !first {
		t.Fatal("the first copy was told it is not the first")
	}
	select {
	case <-wake:
		t.Fatal("woken before anything else started")
	case <-time.After(50 * time.Millisecond):
	}
	for i := 0; i < 2; i++ {
		if _, first := Claim(name); first {
			t.Fatal("a later copy was told it is the first")
		}
		select {
		case <-wake:
		case <-time.After(2 * time.Second):
			t.Fatal("the first copy was not told")
		}
	}
}
