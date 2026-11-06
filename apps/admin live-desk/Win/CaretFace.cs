using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using LiveDesk.Core;

namespace LiveDesk.Win;

public enum FaceState { Still, Writing, Waiting }

/// <summary>What the icon beside the cursor looks like, and how it moves. The leaf is the KIASA line
/// drawing, unchanged, on a dark disc that reads on any document. While words are going in, a soft green
/// line travels around the leaf's borders, as it does on the site's loading mark: leaf after leaf,
/// out along one border and back along the other. Nothing else about it moves unless something happens.
///
/// All motion runs from <see cref="Advance"/>, so it can be stopped when nothing moves, and so a
/// picture of any moment can be taken. With Windows' animations turned off, it simply shows each state.</summary>
public sealed class CaretFace : Grid
{
    /// <summary>Room left around the icon for its shadow.</summary>
    public const double Room = 14;

    private const double DiscSize = 36;
    private const double LeafSize = 28;
    private const double LineWeight = 4.2;      // The header's own idea: thicker lines at small sizes.
    // The middle of the plant, as the smallest circle around all its lines: each leaf tip is then the same
    // distance from the ring. The drawing's own square is not centred on it, the tall leaf sits high.
    private const double PlantCentreX = 628.7, PlantCentreY = 657.8;
    private const double LightSpeed = 520;      // Along the borders, in the drawing's units a second: the site's.
    private const double BubbleMost = 560;
    private const double BubbleHeight = 36;
    private const double BubblePadding = 14;
    private const double LingerSeconds = 0.9;   // So that word by word, the bubble does not blink between words.

    private static readonly Color LeafGreen = Color.FromRgb(0xB8, 0xEC, 0x93);
    private static readonly Color BrightGreen = Color.FromRgb(0x98, 0xFF, 0x4D);   // The site's --leaf-bright.
    private static readonly Color Amber = Color.FromRgb(0xF2, 0xD3, 0x6B);
    private static readonly Color Night = Color.FromRgb(0x0A, 0x14, 0x10);

    // The travelling line: stretches that all end at its head, each shorter and brighter, from a long
    // faint tail to a bright tip. One colour; only its strength changes. [length, opacity, width]
    private static readonly (double Length, double Opacity, double Width)[] Comet =
    [
        (300, 0.22, 44), (220, 0.28, 44), (150, 0.36, 42), (90, 0.5, 40), (40, 0.75, 38), (8, 1.0, 50),
    ];
    private const double InkWhileWriting = 0.76;   // At this size, white lines at full strength hide the light.
    private static readonly (string Id, bool Reverse)[] Route =
    [
        ("crown-margin-l", false), ("crown-margin-r", true),
        ("right-margin-u", false), ("right-margin-d", true),
        ("left-margin-d", false), ("left-margin-u", true),
    ];

    private static readonly ImageSource LeafImage = MakeLeaf();
    private static readonly Geometry RouteGeometry = MakeRoute(out RouteLength);
    private static readonly double RouteLength;

    private readonly bool _still = !SystemParameters.ClientAreaAnimation;
    private readonly FrameworkElement _mark;
    private readonly ScaleTransform _markScale = new(1, 1);
    private readonly Ellipse _ring;
    private readonly SolidColorBrush _ringBrush = new(LeafGreen);
    private readonly Ellipse _pulse;
    private readonly ScaleTransform _pulseScale = new(1, 1);
    private readonly Image _leaf;
    private double _inkShown = 1;
    private readonly Canvas _light;
    private readonly List<(Path Path, double Length, double Width)> _stretches = [];
    private readonly Grid _bubble;
    private readonly Border _bubbleBack;
    private readonly SolidColorBrush _bubbleEdge = new(LeafGreen) { Opacity = 0.4 };
    private readonly TranslateTransform _bubbleSlide = new();
    private readonly TextBlock _words;
    private readonly FrameworkElement _wordsArea;
    private static readonly Brush FadeOlderWords = MakeFade();

    private FaceState _state = FaceState.Still;
    private bool _leaving = true;
    private double _presence;
    private double _lightShown;
    private double _head;
    private double _time;
    private double _amber;
    private double _ringStrength = 0.4;
    private double _land;
    private bool _bubbleOn;
    private double _bubbleShown;
    private double _bubbleWidth;
    private double _bubbleWant;
    private double _emptyFor = -1;

    public CaretFace()
    {
        IsHitTestVisible = false;
        Margin = new Thickness(Room);
        UseLayoutRounding = false;
        SnapsToDevicePixels = false;
        Opacity = 0;

        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
        Children.Add(row);

        // ── The disc and the leaf ──────────────────────────────────────────────────────────────
        var mark = new Grid { Width = DiscSize, Height = DiscSize, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = _markScale };
        _mark = mark;
        mark.Children.Add(new Ellipse
        {
            Fill = new SolidColorBrush(Night),
            Effect = new DropShadowEffect { BlurRadius = 12, ShadowDepth = 2, Direction = 270, Opacity = 0.42, Color = Colors.Black },
            CacheMode = new BitmapCache(),
        });
        mark.Children.Add(new Ellipse
        {
            Fill = new LinearGradientBrush(Color.FromRgb(0x16, 0x24, 0x1D), Night, 90),
        });
        _pulse = new Ellipse
        {
            Stroke = new SolidColorBrush(LeafGreen),
            StrokeThickness = 1.5,
            Opacity = 0,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = _pulseScale,
        };
        mark.Children.Add(_pulse);
        _ring = new Ellipse { Stroke = _ringBrush, StrokeThickness = 1, Opacity = _ringStrength };
        mark.Children.Add(_ring);
        var scale = LeafSize / LeafDrawing.ViewSize;
        var toCentreX = (LeafDrawing.ViewX + LeafDrawing.ViewSize / 2 - PlantCentreX) * scale;
        var toCentreY = (LeafDrawing.ViewY + LeafDrawing.ViewSize / 2 - PlantCentreY) * scale;
        _leaf = new Image { Source = LeafImage, Width = LeafSize, Height = LeafSize, Stretch = Stretch.Fill, RenderTransform = new TranslateTransform(toCentreX, toCentreY) };
        mark.Children.Add(_leaf);

        // The travelling line, over the unchanged drawing.
        _light = new Canvas
        {
            Width = LeafSize,
            Height = LeafSize,
            Opacity = 0,
            Visibility = Visibility.Collapsed,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ClipToBounds = false,
            RenderTransform = new TransformGroup
            {
                Children =
                {
                    new TranslateTransform(-LeafDrawing.ViewX, -LeafDrawing.ViewY),
                    new ScaleTransform(scale, scale),
                    new TranslateTransform(toCentreX, toCentreY),
                },
            },
        };
        foreach (var (length, opacity, width) in Comet)
        {
            var path = new Path
            {
                Data = RouteGeometry,
                Stroke = new SolidColorBrush(BrightGreen) { Opacity = opacity },
                StrokeThickness = width,
                StrokeDashCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                StrokeDashArray = [length / width, (RouteLength - length) / width],
            };
            _light.Children.Add(path);
            _stretches.Add((path, length, width));
        }
        mark.Children.Add(_light);
        row.Children.Add(mark);

        // ── The bubble ─────────────────────────────────────────────────────────────────────────
        _bubble = new Grid
        {
            Height = BubbleHeight,
            Margin = new Thickness(6, 0, 0, 0),
            Visibility = Visibility.Collapsed,
            RenderTransform = _bubbleSlide,
        };
        _bubble.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(BubbleHeight / 2),
            Background = new SolidColorBrush(Night),
            Effect = new DropShadowEffect { BlurRadius = 12, ShadowDepth = 2, Direction = 270, Opacity = 0.42, Color = Colors.Black },
            CacheMode = new BitmapCache(),
        });
        _bubbleBack = new Border
        {
            CornerRadius = new CornerRadius(BubbleHeight / 2),
            BorderThickness = new Thickness(1),
            BorderBrush = _bubbleEdge,
            Background = new LinearGradientBrush(Color.FromRgb(0x16, 0x24, 0x1D), Night, 90),
        };
        _bubble.Children.Add(_bubbleBack);
        _words = new TextBlock
        {
            Foreground = new SolidColorBrush(Color.FromRgb(0xEC, 0xFF, 0xF3)),
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI"),
            FontSize = 14,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        // The newest words stay in view at the right; older ones leave at the left, fading out.
        var clip = new Canvas { ClipToBounds = true, Margin = new Thickness(BubblePadding, 0, BubblePadding, 0) };
        _wordsArea = clip;
        var holder = new Grid();
        holder.Children.Add(_words);
        clip.Children.Add(holder);
        clip.SizeChanged += (_, e) =>
        {
            holder.Height = e.NewSize.Height;
            Canvas.SetRight(holder, 0);
        };
        _bubble.Children.Add(clip);
        row.Children.Add(_bubble);
    }

    private static Brush MakeFade()
    {
        var fade = new LinearGradientBrush(new GradientStopCollection
        {
            new(Colors.Transparent, 0),
            new(Colors.Black, 1),
        }, new Point(0, 0), new Point(40, 0)) { MappingMode = BrushMappingMode.Absolute };
        fade.Freeze();
        return fade;
    }

    private static ImageSource MakeLeaf()
    {
        var ink = new SolidColorBrush((Color)ColorConverter.ConvertFromString(LeafDrawing.Ink));
        ink.Freeze();
        Pen Line(double width)
        {
            var pen = new Pen(ink, width * LineWeight) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
            pen.Freeze();
            return pen;
        }
        var group = new DrawingGroup();
        // Holds the picture to the drawing's own square, whatever the lines reach.
        group.Children.Add(new GeometryDrawing(Brushes.Transparent, null, new RectangleGeometry(new Rect(LeafDrawing.ViewX, LeafDrawing.ViewY, LeafDrawing.ViewSize, LeafDrawing.ViewSize))));
        foreach (var line in LeafDrawing.Lines) group.Children.Add(new GeometryDrawing(null, Line(line.Ink), Geometry.Parse(line.Path)));
        foreach (var drop in LeafDrawing.Drops)
        {
            group.Children.Add(new GeometryDrawing(null, Line(LeafDrawing.Ring), new EllipseGeometry(new Point(drop.X, drop.Y), drop.R, drop.R)));
            group.Children.Add(new GeometryDrawing(null, Line(LeafDrawing.Ring - 0.3), Geometry.Parse(drop.Glint)));
        }
        group.ClipGeometry = new RectangleGeometry(new Rect(LeafDrawing.ViewX, LeafDrawing.ViewY, LeafDrawing.ViewSize, LeafDrawing.ViewSize));
        group.Freeze();
        var image = new DrawingImage(group);
        image.Freeze();
        return image;
    }

    /// <summary>The line the light follows: the leaves' borders, joined into one closed run.</summary>
    private static Geometry MakeRoute(out double length)
    {
        var points = new List<Point>();
        foreach (var (id, reverse) in Route)
        {
            var line = LeafDrawing.Lines.First(l => l.Id == id);
            var flat = Geometry.Parse(line.Path).GetFlattenedPathGeometry(0.5, ToleranceType.Absolute);
            var leg = new List<Point>();
            foreach (var figure in flat.Figures)
            {
                leg.Add(figure.StartPoint);
                foreach (var segment in figure.Segments)
                {
                    if (segment is PolyLineSegment many) leg.AddRange(many.Points);
                    else if (segment is LineSegment one) leg.Add(one.Point);
                }
            }
            if (reverse) leg.Reverse();
            points.AddRange(leg);
        }
        length = 0;
        for (var i = 0; i < points.Count; i++) length += (points[(i + 1) % points.Count] - points[i]).Length;
        var route = new StreamGeometry();
        using (var draw = route.Open())
        {
            draw.BeginFigure(points[0], false, true);
            draw.PolyLineTo(points.Skip(1).ToArray(), true, false);
        }
        route.Freeze();
        return route;
    }

    public FaceState State
    {
        get => _state;
        set => _state = value;
    }

    /// <summary>It has left, and the window can be hidden.</summary>
    public bool HasLeft => _leaving && _presence <= 0;

    public bool IsLeaving => _leaving;

    public void Appear()
    {
        _leaving = false;
    }

    public void Leave()
    {
        _leaving = true;
    }

    /// <summary>Words went in: the ring answers, once, softly.</summary>
    public void Landed()
    {
        if (_land < 0.35) _land = 1;
    }

    /// <summary>The words beside the icon. Empty: the bubble stays a moment, then goes.</summary>
    public void ShowWords(string words, bool warn)
    {
        if (words.Length == 0)
        {
            if (_bubbleOn && _emptyFor < 0) _emptyFor = 0;
            return;
        }
        _emptyFor = -1;
        _bubbleOn = true;
        var edge = warn ? Amber : LeafGreen;
        _bubbleEdge.Color = edge;
        _bubbleEdge.Opacity = warn ? 0.85 : 0.4;
        if (_words.Text == words) return;
        _words.Text = words;
        _words.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        _bubbleWant = Math.Min(BubbleMost, Math.Ceiling(_words.DesiredSize.Width) + BubblePadding * 2);
        _wordsArea.OpacityMask = _words.DesiredSize.Width + BubblePadding * 2 > BubbleMost ? FadeOlderWords : null;
        if (_bubble.Visibility != Visibility.Visible || _still)
        {
            _bubbleWidth = _bubbleWant;
            _bubble.Width = _bubbleWidth;
            _bubble.Visibility = Visibility.Visible;
        }
    }

    private static double Toward(double now, double want, double step) =>
        now < want ? Math.Min(want, now + step) : Math.Max(want, now - step);

    private static double EaseOut(double x) => 1 - Math.Pow(1 - x, 3);

    /// <summary>Moves on by this many seconds. Gives back whether anything is still moving.</summary>
    public bool Advance(double seconds)
    {
        var dt = _still ? 1000 : Math.Min(seconds, 0.1);
        _time += _still ? 0 : dt;

        // Coming and going: a soft fade, and a small growth as it comes.
        _presence = Toward(_presence, _leaving ? 0 : 1, dt / (_leaving ? 0.1 : 0.16));
        Opacity = _presence;
        var grown = 0.86 + 0.14 * EaseOut(_presence);
        _markScale.ScaleX = _markScale.ScaleY = grown;

        // The travelling line. It stops where it is, so it picks up from there.
        var writing = _state == FaceState.Writing && !_still;
        _lightShown = Toward(_lightShown, writing ? 1 : 0, dt / 0.35);
        _light.Opacity = _lightShown;
        _inkShown = 1 - (1 - InkWhileWriting) * _lightShown;
        _leaf.Opacity = _inkShown;
        _light.Visibility = _lightShown > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (_lightShown > 0)
        {
            _head = (_head + LightSpeed * dt) % RouteLength;
            foreach (var (path, length, width) in _stretches)
                path.StrokeDashOffset = (length - _head + RouteLength) % RouteLength / width;
        }

        // The ring: amber when words are waiting, breathing slowly; green and quiet otherwise.
        _amber = Toward(_amber, _state == FaceState.Waiting ? 1 : 0, dt / 0.2);
        _ringBrush.Color = Color.FromRgb(
            (byte)(LeafGreen.R + (Amber.R - LeafGreen.R) * _amber),
            (byte)(LeafGreen.G + (Amber.G - LeafGreen.G) * _amber),
            (byte)(LeafGreen.B + (Amber.B - LeafGreen.B) * _amber));
        var ringWant = _state switch
        {
            FaceState.Waiting => _still ? 0.9 : 0.62 + 0.33 * Math.Sin(_time * Math.PI * 2 / 1.8),
            FaceState.Writing => 0.6,
            _ => 0.4,
        };
        _ringStrength += (ringWant - _ringStrength) * (1 - Math.Exp(-dt / 0.09));
        _ring.Opacity = _ringStrength;

        // Words landing.
        if (_land > 0 && !_still)
        {
            _land = Math.Max(0, _land - dt / 0.36);
            var out_ = EaseOut(1 - _land);
            _pulseScale.ScaleX = _pulseScale.ScaleY = 1 + 0.22 * out_;
            _pulse.Opacity = 0.55 * _land;
        }
        else _pulse.Opacity = 0;

        // The bubble: stays a moment when empty, then fades; its width follows the words.
        if (_emptyFor >= 0)
        {
            _emptyFor += _still ? 1000 : dt;
            if (_emptyFor >= LingerSeconds)
            {
                _bubbleOn = false;
                _emptyFor = -1;
            }
        }
        _bubbleShown = Toward(_bubbleShown, _bubbleOn ? 1 : 0, dt / 0.14);
        _bubble.Opacity = EaseOut(_bubbleShown);
        _bubbleSlide.X = -6 * (1 - EaseOut(_bubbleShown));
        if (_bubbleShown <= 0 && !_bubbleOn && _bubble.Visibility == Visibility.Visible)
        {
            _bubble.Visibility = Visibility.Collapsed;
            _words.Text = "";
        }
        if (_bubble.Visibility == Visibility.Visible)
        {
            _bubbleWidth += (_bubbleWant - _bubbleWidth) * (1 - Math.Exp(-dt / 0.055));
            if (Math.Abs(_bubbleWant - _bubbleWidth) < 0.5) _bubbleWidth = _bubbleWant;
            _bubble.Width = _bubbleWidth;
        }

        return !_still && (
            _state != FaceState.Still ||
            _lightShown > 0 ||
            _land > 0 ||
            _amber > 0 ||
            Math.Abs(ringWant - _ringStrength) > 0.005 ||
            _presence > 0 && _presence < 1 ||
            _leaving && _presence > 0 ||
            _emptyFor >= 0 ||
            _bubbleShown > 0 && _bubbleShown < 1 ||
            Math.Abs(_bubbleWant - _bubbleWidth) > 0.01 && _bubble.Visibility == Visibility.Visible);
    }
}
