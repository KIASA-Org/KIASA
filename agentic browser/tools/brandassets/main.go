// brandassets makes the icon and small logo from the KIASA logo.
//
//	go run ./tools/brandassets
//
// The wordmark cannot be read at small sizes, so sizes below 128 pixels use the leaf
// alone and larger ones use the whole logo.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"path/filepath"
)

const (
	logoFile = "assets/kiasa-logo.png"
	icoFile  = "assets/kiasa.ico"
	// pageLogo is the leaf the settings window shows.
	pageLogo = "internal/settingsui/logo.png"
	// These give the top of the wordmark and how far it reaches sideways, in logo pixels.
	wordmarkTop   = 942
	wordmarkLeft  = 232
	wordmarkRight = 1000
)

var (
	leafBox = image.Rect(130, 85, 1095, 1050)
	fullBox = image.Rect(90, 100, 1110, 1120)
)

func main() {
	logo := load(logoFile)
	leaf := withoutWordmark(logo)

	type entry struct {
		size int
		data []byte
	}
	var entries []entry
	for _, size := range []int{16, 20, 24, 32, 40, 48, 64, 128, 256} {
		var im *image.NRGBA
		if size < 128 {
			im = shrink(leaf, leafBox, size)
		} else {
			im = shrink(logo, fullBox, size)
		}
		entries = append(entries, entry{size, encode(im)})
	}

	var ico bytes.Buffer
	binary.Write(&ico, binary.LittleEndian, []uint16{0, 1, uint16(len(entries))})
	offset := uint32(6 + 16*len(entries))
	for _, e := range entries {
		side := byte(e.size)
		if e.size >= 256 {
			side = 0 // the format writes 256 as 0
		}
		ico.Write([]byte{side, side, 0, 0})
		binary.Write(&ico, binary.LittleEndian, []uint16{1, 32})
		binary.Write(&ico, binary.LittleEndian, []uint32{uint32(len(e.data)), offset})
		offset += uint32(len(e.data))
	}
	for _, e := range entries {
		ico.Write(e.data)
	}
	write(icoFile, ico.Bytes())
	write(pageLogo, encode(shrink(leaf, leafBox, 128)))
	fmt.Println("wrote", icoFile, "and", pageLogo)
}

func load(path string) *image.NRGBA {
	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		log.Fatal(err)
	}
	b := src.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			out.Set(x, y, src.At(x, y))
		}
	}
	return out
}

func withoutWordmark(logo *image.NRGBA) *image.NRGBA {
	b := logo.Bounds()
	leaf := image.NewNRGBA(b)
	copy(leaf.Pix, logo.Pix)
	for y := wordmarkTop; y < b.Max.Y; y++ {
		for x := wordmarkLeft; x < wordmarkRight; x++ {
			leaf.SetNRGBA(x, y, color.NRGBA{})
		}
	}
	return leaf
}

// shrink averages with premultiplied alpha, so edges do not pick up the colour of the
// fully transparent pixels around them.
func shrink(src *image.NRGBA, r image.Rectangle, size int) *image.NRGBA {
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	w, h := r.Dx(), r.Dy()
	for dy := 0; dy < size; dy++ {
		y0, y1 := r.Min.Y+dy*h/size, r.Min.Y+(dy+1)*h/size
		for dx := 0; dx < size; dx++ {
			x0, x1 := r.Min.X+dx*w/size, r.Min.X+(dx+1)*w/size
			var pr, pg, pb, pa, n uint64
			for y := y0; y < y1; y++ {
				for x := x0; x < x1; x++ {
					c := src.NRGBAAt(x, y)
					a := uint64(c.A)
					pr += uint64(c.R) * a
					pg += uint64(c.G) * a
					pb += uint64(c.B) * a
					pa += a
					n++
				}
			}
			if pa == 0 || n == 0 {
				continue
			}
			out.SetNRGBA(dx, dy, color.NRGBA{uint8(pr / pa), uint8(pg / pa), uint8(pb / pa), uint8(pa / n)})
		}
	}
	return out
}

func encode(im image.Image) []byte {
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		log.Fatal(err)
	}
	return b.Bytes()
}

func write(path string, data []byte) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Fatal(err)
	}
}
