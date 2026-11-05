//go:build windows

package settings

// Seal and Unseal let other packages keep a secret the same way the settings do: with Windows
// data protection, so only this Windows user on this PC can read it.
func Seal(plain []byte) ([]byte, error)    { return seal(plain) }
func Unseal(sealed []byte) ([]byte, error) { return unseal(sealed) }
