// Package single keeps one KIASA Browser running on a computer. Pressing Start on
// the Auto apply page while it is already open starts the program again, and that
// second copy only tells the first one and ends.
package single

import (
	"syscall"
	"unsafe"
)

var (
	kernel32    = syscall.NewLazyDLL("kernel32.dll")
	createEvent = kernel32.NewProc("CreateEventW")
	setEvent    = kernel32.NewProc("SetEvent")
	waitFor     = kernel32.NewProc("WaitForSingleObject")
)

const waitForever = 0xFFFFFFFF

// Claim tries to be the one copy running under this name. The first copy gets a
// channel that fires whenever another copy starts. Any later copy tells the first
// one and gets false. If Windows cannot answer, the program just runs.
func Claim(name string) (wake <-chan struct{}, first bool) {
	text, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, true
	}
	// An event that resets itself each time it is waited on, starting unset. Windows
	// removes it when the last program holding it ends, even after a crash.
	handle, _, lastErr := createEvent.Call(0, 0, 0, uintptr(unsafe.Pointer(text)))
	if handle == 0 {
		return nil, true
	}
	if lastErr == syscall.ERROR_ALREADY_EXISTS {
		setEvent.Call(handle)
		syscall.CloseHandle(syscall.Handle(handle))
		return nil, false
	}
	woken := make(chan struct{}, 1)
	go func() {
		for {
			if result, _, _ := waitFor.Call(handle, waitForever); result != 0 {
				return
			}
			select {
			case woken <- struct{}{}:
			default: // already waiting to be noticed
			}
		}
	}()
	return woken, true
}
