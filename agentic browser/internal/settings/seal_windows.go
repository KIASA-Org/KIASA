//go:build windows

package settings

import (
	"syscall"
	"unsafe"
)

var (
	crypt32        = syscall.NewLazyDLL("crypt32.dll")
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	cryptProtect   = crypt32.NewProc("CryptProtectData")
	cryptUnprotect = crypt32.NewProc("CryptUnprotectData")
	localFree      = kernel32.NewProc("LocalFree")
)

const cryptProtectUIForbidden = 1

type dataBlob struct {
	size uint32
	data *byte
}

func newBlob(b []byte) *dataBlob {
	if len(b) == 0 {
		return &dataBlob{}
	}
	return &dataBlob{size: uint32(len(b)), data: &b[0]}
}

func (b *dataBlob) take() []byte {
	if b.data == nil {
		return nil
	}
	defer localFree.Call(uintptr(unsafe.Pointer(b.data)))
	return append([]byte(nil), unsafe.Slice(b.data, b.size)...)
}

// seal encrypts with the Windows data protection service. Only this Windows user, on
// this computer, can read the result.
func seal(plain []byte) ([]byte, error) {
	var out dataBlob
	r, _, err := cryptProtect.Call(uintptr(unsafe.Pointer(newBlob(plain))), 0, 0, 0, 0, cryptProtectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, err
	}
	return out.take(), nil
}

func unseal(sealed []byte) ([]byte, error) {
	var out dataBlob
	r, _, err := cryptUnprotect.Call(uintptr(unsafe.Pointer(newBlob(sealed))), 0, 0, 0, 0, cryptProtectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, err
	}
	return out.take(), nil
}
