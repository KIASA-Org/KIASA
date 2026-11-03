package browser

import (
	"math"
	"math/rand"
	"testing"
	"time"
)

// These tests cover the planning functions only; they need no browser.

func TestMousePath_LandsExactlyOnTheTarget(t *testing.T) {
	for seed := int64(0); seed < 200; seed++ {
		rng := rand.New(rand.NewSource(seed))
		from := Point{rng.Float64() * 1900, rng.Float64() * 1000}
		to := Point{rng.Float64() * 1900, rng.Float64() * 1000}

		path := mousePath(from, to, rng)
		if len(path) == 0 {
			t.Fatalf("seed %d: empty path", seed)
		}
		if last := path[len(path)-1].To; last != to {
			t.Fatalf("seed %d: path ends at %v, want %v", seed, last, to)
		}
	}
}

func TestMousePath_IsCurvedSmoothAndTakesTime(t *testing.T) {
	curved := 0
	const runs = 300
	for seed := int64(0); seed < runs; seed++ {
		rng := rand.New(rand.NewSource(seed))
		from := Point{100, 100}
		to := Point{100 + 300 + rng.Float64()*1200, 100 + rng.Float64()*700}
		dist := math.Hypot(to.X-from.X, to.Y-from.Y)

		path := mousePath(from, to, rng)

		var total time.Duration
		prev := from
		maxOff := 0.0
		for _, s := range path {
			if step := math.Hypot(s.To.X-prev.X, s.To.Y-prev.Y); step > 0.2*dist+3 {
				t.Fatalf("seed %d: the pointer jumped %.0f px in one step on a %.0f px move", seed, step, dist)
			}
			// distance from the straight line from -> to
			off := math.Abs((to.Y-from.Y)*s.To.X-(to.X-from.X)*s.To.Y+to.X*from.Y-to.Y*from.X) / dist
			maxOff = math.Max(maxOff, off)
			total += s.Wait
			prev = s.To
		}
		if maxOff > 0.01*dist {
			curved++
		}
		if total < 150*time.Millisecond || total > 2500*time.Millisecond {
			t.Errorf("seed %d: a %.0f px move took %v", seed, dist, total)
		}
	}
	if curved < runs*9/10 {
		t.Errorf("only %d of %d long moves bent away from the straight line", curved, runs)
	}
}

func TestMousePath_LongerMovesTakeLonger(t *testing.T) {
	duration := func(dist float64) time.Duration {
		var sum time.Duration
		for seed := int64(0); seed < 100; seed++ {
			rng := rand.New(rand.NewSource(seed))
			for _, s := range mousePath(Point{0, 0}, Point{dist, 0}, rng) {
				sum += s.Wait
			}
		}
		return sum / 100
	}
	short, long := duration(80), duration(1500)
	if long <= short {
		t.Errorf("a 1500 px move averaged %v, a 80 px move %v", long, short)
	}
}

func TestMousePath_TinyMoveIsOneStep(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	to := Point{100.5, 100}
	path := mousePath(Point{100, 100}, to, rng)
	if len(path) != 1 || path[0].To != to {
		t.Errorf("got %v, want a single step to %v", path, to)
	}
}

func TestClickPoint_StaysInsideTheBoxAndAwayFromTheEdge(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	offCentre := 0
	for i := 0; i < 2000; i++ {
		x, y, w, h := 50.0, 80.0, 40.0+rng.Float64()*200, 12.0+rng.Float64()*60
		p := clickPoint(x, y, w, h, rng)
		if p.X < x+math.Min(3, w/4) || p.X > x+w-math.Min(3, w/4) || p.Y < y+math.Min(3, h/4) || p.Y > y+h-math.Min(3, h/4) {
			t.Fatalf("point %v is outside or on the edge of box (%v,%v,%v,%v)", p, x, y, w, h)
		}
		if p.X != x+w/2 || p.Y != y+h/2 {
			offCentre++
		}
	}
	if offCentre < 1900 {
		t.Errorf("only %d of 2000 clicks were off-centre", offCentre)
	}
}

func TestClickPoint_TinyBox(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	p := clickPoint(10, 10, 2, 2, rng)
	if p.X < 10 || p.X > 12 || p.Y < 10 || p.Y > 12 {
		t.Errorf("point %v is outside a 2x2 box at (10,10)", p)
	}
}

func TestKeyDelay_VariesAndStaysBounded(t *testing.T) {
	rng := rand.New(rand.NewSource(11))
	const n = 5000
	var sum, sumSq float64
	var letters, spaces float64
	var nLetters, nSpaces int
	for i := 0; i < n; i++ {
		letter := keyDelay(rng, 'e')
		space := keyDelay(rng, ' ')
		for _, d := range []time.Duration{letter, space} {
			if d < 35*time.Millisecond || d > 1500*time.Millisecond {
				t.Fatalf("delay %v is outside 35ms..1.5s", d)
			}
		}
		ms := float64(letter) / float64(time.Millisecond)
		sum += ms
		sumSq += ms * ms
		letters += ms
		nLetters++
		spaces += float64(space) / float64(time.Millisecond)
		nSpaces++
	}
	mean := sum / n
	sd := math.Sqrt(sumSq/n - mean*mean)
	if mean < 70 || mean > 160 {
		t.Errorf("mean delay between letters is %.0f ms", mean)
	}
	if sd/mean < 0.25 {
		t.Errorf("typing rhythm is too even: standard deviation is %.0f%% of the mean", 100*sd/mean)
	}
	if spaces/float64(nSpaces) <= letters/float64(nLetters) {
		t.Error("the pause after a space is not longer than after a letter")
	}
}

func TestScrollChunks_AddUpToTheTotal(t *testing.T) {
	for _, total := range []float64{1, 80, 100, 101, 900, 3000, -1234.5, -100, 250.25} {
		rng := rand.New(rand.NewSource(int64(total*100) + 5))
		chunks := scrollChunks(total, rng)

		var sum float64
		for _, c := range chunks {
			if math.Abs(c.Delta) > 100.000001 || c.Delta == 0 {
				t.Errorf("total %v: chunk %v is not a notch of up to 100 px", total, c.Delta)
			}
			if (c.Delta < 0) != (total < 0) {
				t.Errorf("total %v: chunk %v scrolls the wrong way", total, c.Delta)
			}
			if c.Wait <= 0 {
				t.Errorf("total %v: chunk waits %v", total, c.Wait)
			}
			sum += c.Delta
		}
		if math.Abs(sum-total) > 1e-9 {
			t.Errorf("chunks add up to %v, want %v", sum, total)
		}
	}
	if got := scrollChunks(0, rand.New(rand.NewSource(1))); got != nil {
		t.Errorf("a zero scroll should send nothing, got %v", got)
	}
}
