package browser

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"
)

// Point is a position on the page in CSS pixels.
type Point struct{ X, Y float64 }

// Human drives a page the way a person would: the pointer travels along a
// curved path at a changing speed, clicks land off-centre after a moment's
// hover, typing has uneven rhythm, and scrolling comes in flicks of the wheel.
// All input goes through the browser's own input pipeline, so the events are
// trusted ones.
type Human struct {
	page playwright.Page
	rng  *rand.Rand
	pos  Point // where the pointer last was
}

// NewHuman returns a Human that drives the given page.
func NewHuman(page playwright.Page) *Human {
	return newHuman(page, time.Now().UnixNano())
}

func newHuman(page playwright.Page, seed int64) *Human {
	rng := rand.New(rand.NewSource(seed))
	return &Human{
		page: page,
		rng:  rng,
		pos:  Point{X: 200 + rng.Float64()*600, Y: 150 + rng.Float64()*300},
	}
}

// MoveTo moves the pointer to (x, y). A long move sometimes overshoots the
// target slightly and comes back, as a hand does.
func (h *Human) MoveTo(x, y float64) error {
	target := Point{X: x, Y: y}
	dist := math.Hypot(target.X-h.pos.X, target.Y-h.pos.Y)

	legs := []Point{target}
	if dist > 250 && h.rng.Float64() < 0.15 {
		past := 4 + h.rng.Float64()*8
		over := Point{
			X: target.X + (target.X-h.pos.X)/dist*past,
			Y: target.Y + (target.Y-h.pos.Y)/dist*past,
		}
		legs = []Point{over, target}
	}

	for _, leg := range legs {
		for _, step := range mousePath(h.pos, leg, h.rng) {
			if err := h.page.Mouse().Move(step.To.X, step.To.Y); err != nil {
				return fmt.Errorf("moving the pointer: %w", err)
			}
			time.Sleep(step.Wait)
		}
		h.pos = leg
	}
	return nil
}

// Click scrolls the element into view, moves to a point inside it, rests on it
// for a moment, and presses and releases the primary button.
func (h *Human) Click(selector string) error {
	element := h.page.Locator(selector).First()
	if err := element.ScrollIntoViewIfNeeded(); err != nil {
		return fmt.Errorf("scrolling %q into view: %w", selector, err)
	}
	box, err := element.BoundingBox()
	if err != nil {
		return fmt.Errorf("measuring %q: %w", selector, err)
	}
	if box == nil {
		return fmt.Errorf("%q has no size on the page", selector)
	}

	target := clickPoint(box.X, box.Y, box.Width, box.Height, h.rng)
	if err := h.MoveTo(target.X, target.Y); err != nil {
		return err
	}
	h.Pause(60, 220) // looking at it before pressing
	if err := h.page.Mouse().Down(); err != nil {
		return fmt.Errorf("pressing the button: %w", err)
	}
	h.Pause(45, 130) // how long the button is held
	if err := h.page.Mouse().Up(); err != nil {
		return fmt.Errorf("releasing the button: %w", err)
	}
	return nil
}

// Type clicks the element and then types text one key at a time, with the
// uneven rhythm of a person: longer after spaces and punctuation, and an
// occasional pause to think.
func (h *Human) Type(selector, text string) error {
	if err := h.Click(selector); err != nil {
		return err
	}
	h.Pause(120, 400) // hands move to the keyboard
	for _, r := range text {
		if err := h.page.Keyboard().Type(string(r)); err != nil {
			return fmt.Errorf("typing %q: %w", string(r), err)
		}
		time.Sleep(keyDelay(h.rng, r))
	}
	return nil
}

// Scroll scrolls by dy pixels (negative scrolls up) in flicks of the wheel.
func (h *Human) Scroll(dy float64) error {
	for _, chunk := range scrollChunks(dy, h.rng) {
		if err := h.page.Mouse().Wheel(0, chunk.Delta); err != nil {
			return fmt.Errorf("scrolling: %w", err)
		}
		time.Sleep(chunk.Wait)
	}
	return nil
}

// Pause waits a random time between minMS and maxMS milliseconds.
func (h *Human) Pause(minMS, maxMS int) {
	if maxMS < minMS {
		maxMS = minMS
	}
	time.Sleep(millis(float64(minMS) + h.rng.Float64()*float64(maxMS-minMS)))
}

// Read waits about as long as a person takes to read the given number of words.
func (h *Human) Read(words int) {
	perSecond := 3.2 + h.rng.Float64()*1.6
	seconds := math.Min(float64(words)/perSecond, 30)
	time.Sleep(millis(seconds * 1000 * (0.9 + 0.2*h.rng.Float64())))
}

type pathStep struct {
	To   Point
	Wait time.Duration
}

// mousePath plans a pointer move from one point to another: a cubic Bezier
// curve bent to one side, travelled with easing (slow, fast, slow), a little
// hand tremor, and a duration that grows with distance as in Fitts's law. The
// last step lands exactly on the target.
func mousePath(from, to Point, rng *rand.Rand) []pathStep {
	dx, dy := to.X-from.X, to.Y-from.Y
	dist := math.Hypot(dx, dy)
	if dist < 2 {
		return []pathStep{{To: to, Wait: millis(8 + rng.Float64()*10)}}
	}

	total := (170 + 150*math.Log2(dist/30+1)) * (0.85 + 0.3*rng.Float64()) // milliseconds
	n := clampInt(int(total/11), 8, 120)

	nx, ny := -dy/dist, dx/dist // unit vector at right angles to the straight line
	bend1 := (rng.Float64()*2 - 1) * 0.18 * dist
	bend2 := (rng.Float64()*2 - 1) * 0.18 * dist
	c1 := Point{from.X + dx*0.30 + nx*bend1, from.Y + dy*0.30 + ny*bend1}
	c2 := Point{from.X + dx*0.72 + nx*bend2, from.Y + dy*0.72 + ny*bend2}

	steps := make([]pathStep, 0, n)
	for i := 1; i <= n; i++ {
		p := cubicBezier(from, c1, c2, to, easeInOut(float64(i)/float64(n)))
		if i < n {
			p.X += rng.NormFloat64() * 0.5
			p.Y += rng.NormFloat64() * 0.5
		}
		steps = append(steps, pathStep{To: p, Wait: millis(total / float64(n) * (0.7 + 0.6*rng.Float64()))})
	}
	steps[len(steps)-1].To = to
	return steps
}

func cubicBezier(p0, p1, p2, p3 Point, t float64) Point {
	u := 1 - t
	a, b, c, d := u*u*u, 3*u*u*t, 3*u*t*t, t*t*t
	return Point{
		X: a*p0.X + b*p1.X + c*p2.X + d*p3.X,
		Y: a*p0.Y + b*p1.Y + c*p2.Y + d*p3.Y,
	}
}

func easeInOut(t float64) float64 {
	if t < 0.5 {
		return 4 * t * t * t
	}
	return 1 - math.Pow(-2*t+2, 3)/2
}

// clickPoint picks where inside a box to click: near the middle, but not
// exactly on it, and never right at the edge.
func clickPoint(x, y, w, h float64, rng *rand.Rand) Point {
	px := x + w/2 + rng.NormFloat64()*w/6
	py := y + h/2 + rng.NormFloat64()*h/6
	marginX, marginY := math.Min(3, w/4), math.Min(3, h/4)
	return Point{
		X: clampFloat(px, x+marginX, x+w-marginX),
		Y: clampFloat(py, y+marginY, y+h-marginY),
	}
}

// keyDelay is how long to wait after typing r: log-normal around 95 ms, longer
// after a space or punctuation, and now and then a pause to think.
func keyDelay(rng *rand.Rand, r rune) time.Duration {
	d := 95 * math.Exp(0.35*rng.NormFloat64())
	switch {
	case r == '\n':
		d += 150 + rng.Float64()*250
	case r == ' ':
		d += 20 + rng.Float64()*70
	case strings.ContainsRune(".,;:!?", r):
		d += 60 + rng.Float64()*140
	}
	if rng.Float64() < 0.015 {
		d += 350 + rng.Float64()*750
	}
	return millis(clampFloat(d, 35, 1500))
}

type scrollChunk struct {
	Delta float64
	Wait  time.Duration
}

// scrollChunks splits a scroll into wheel notches of up to 100 px, sent in
// quick flicks of one to four with a rest between flicks. The notches add up to
// exactly total.
func scrollChunks(total float64, rng *rand.Rand) []scrollChunk {
	if total == 0 {
		return nil
	}
	sign := 1.0
	if total < 0 {
		sign = -1
	}
	remaining := math.Abs(total)

	var chunks []scrollChunk
	for remaining > 0 {
		flick := 1 + rng.Intn(4)
		for i := 0; i < flick && remaining > 0; i++ {
			d := math.Min(100, remaining)
			remaining -= d
			wait := millis(14 + rng.Float64()*30)
			if i == flick-1 || remaining <= 0 {
				wait = millis(90 + rng.Float64()*300)
			}
			chunks = append(chunks, scrollChunk{Delta: sign * d, Wait: wait})
		}
	}
	return chunks
}

func millis(ms float64) time.Duration {
	return time.Duration(ms * float64(time.Millisecond))
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}
