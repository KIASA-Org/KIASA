// Package winmsg shows a plain Windows message box. The program runs in a console
// window that closes the moment the program ends, so anything that stops it must
// be said in a box that stays until it is read.
package winmsg

import (
	"syscall"
	"unsafe"
)

var messageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

const (
	iconError = 0x10
	iconInfo  = 0x40
	// foreground and topmost, so the box is not left behind other windows.
	onTop = 0x00010000 | 0x00040000
)

func show(title, text string, flags uintptr) {
	t, _ := syscall.UTF16PtrFromString(title)
	x, _ := syscall.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(x)), uintptr(unsafe.Pointer(t)), flags|onTop)
}

// Error shows a problem and waits until it is closed.
func Error(title, text string) { show(title, text, iconError) }

// Info shows a notice and waits until it is closed.
func Info(title, text string) { show(title, text, iconInfo) }

// Ask shows a question with Yes and No (No chosen unless Yes is pressed) and says
// whether Yes was pressed.
func Ask(title, text string) bool {
	const yesNo, iconWarning, secondDefault, idYes = 0x4, 0x30, 0x100, 6
	t, _ := syscall.UTF16PtrFromString(title)
	x, _ := syscall.UTF16PtrFromString(text)
	pressed, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(x)), uintptr(unsafe.Pointer(t)), yesNo|iconWarning|secondDefault|onTop)
	return pressed == idYes
}
