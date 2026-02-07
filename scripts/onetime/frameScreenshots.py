"""
App Store Screenshot Framing Tool for SoccerView
================================================
Takes raw device screenshots and adds professional caption overlays
for App Store submission.

Usage:
  python scripts/onetime/frameScreenshots.py --input-dir ./screenshots --output-dir ./framed

Requirements:
  pip install Pillow

Output: 1320x2868 PNG files (iPhone 6.9" spec)
"""

import os
import sys
import argparse
from PIL import Image, ImageDraw, ImageFont

# App Store specs
TARGET_WIDTH = 1320
TARGET_HEIGHT = 2868

# Design constants
HEADER_HEIGHT = 380  # Space for caption text
BOTTOM_PADDING = 40
SIDE_PADDING = 40
BG_COLOR = (0, 0, 0)  # Black background (matches app theme)
CAPTION_COLOR = (255, 255, 255)  # White text
SUBTITLE_COLOR = (156, 163, 175)  # Gray subtitle (#9ca3af)

# Caption configurations for each screenshot slot
CAPTIONS = {
    "01": {"title": "100,000+ Teams Ranked", "subtitle": "SoccerView Power Ratings"},
    "02": {"title": "Track Your Team's Journey", "subtitle": "Complete Team Profiles"},
    "03": {"title": "Predict Any Matchup", "subtitle": "AI-Powered Match Predictions"},
    "04": {"title": "Search by State, Age & Gender", "subtitle": "Find Teams Across 50 States"},
    "05": {"title": "Official GotSport Rankings", "subtitle": "Points-Based National Rankings"},
    "06": {"title": "League Standings", "subtitle": "Official Points Tables & Divisions"},
    "07": {"title": "Every Match, Every Score", "subtitle": "Complete Match History"},
    "08": {"title": "Watch Rankings Rise", "subtitle": "Historical Ranking Journey"},
    "09": {"title": "Your Soccer Dashboard", "subtitle": "Everything at a Glance"},
    "10": {"title": "Match Details & Analysis", "subtitle": "Tale of the Tape Comparison"},
}


def get_font(size, bold=False):
    """Try to load a good system font, fall back to default."""
    font_candidates = [
        # Windows
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",  # bold
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/arialbd.ttf",  # bold
        # macOS
        "/System/Library/Fonts/SFProDisplay-Regular.otf",
        "/System/Library/Fonts/SFProDisplay-Bold.otf",
        "/Library/Fonts/Arial.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]

    if bold:
        # Try bold variants first
        bold_candidates = [f for f in font_candidates if "bold" in f.lower() or "Bold" in f or f.endswith("b.ttf")]
        for font_path in bold_candidates:
            if os.path.exists(font_path):
                return ImageFont.truetype(font_path, size)

    for font_path in font_candidates:
        if os.path.exists(font_path):
            return ImageFont.truetype(font_path, size)

    # Fallback
    try:
        return ImageFont.truetype("arial.ttf", size)
    except (OSError, IOError):
        print(f"  Warning: Using default font (no system fonts found)")
        return ImageFont.load_default()


def frame_screenshot(input_path, output_path, caption_config):
    """Add professional caption overlay to a screenshot."""
    # Open the raw screenshot
    img = Image.open(input_path).convert("RGB")
    orig_w, orig_h = img.size

    # Create the output canvas
    canvas = Image.new("RGB", (TARGET_WIDTH, TARGET_HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(canvas)

    # Calculate screenshot placement
    # Screenshot goes below the header, filling remaining space
    available_width = TARGET_WIDTH - (SIDE_PADDING * 2)
    available_height = TARGET_HEIGHT - HEADER_HEIGHT - BOTTOM_PADDING

    # Scale screenshot to fit
    scale = min(available_width / orig_w, available_height / orig_h)
    new_w = int(orig_w * scale)
    new_h = int(orig_h * scale)

    # Resize with high quality
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Center horizontally, place below header
    x_offset = (TARGET_WIDTH - new_w) // 2
    y_offset = HEADER_HEIGHT + (available_height - new_h) // 2

    # Add subtle rounded corner effect to screenshot
    canvas.paste(resized, (x_offset, y_offset))

    # Draw caption text
    title_font = get_font(56, bold=True)
    subtitle_font = get_font(36, bold=False)

    title = caption_config["title"]
    subtitle = caption_config["subtitle"]

    # Center title
    title_bbox = draw.textbbox((0, 0), title, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    title_x = (TARGET_WIDTH - title_w) // 2
    title_y = 100

    # Center subtitle
    sub_bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    sub_w = sub_bbox[2] - sub_bbox[0]
    sub_x = (TARGET_WIDTH - sub_w) // 2
    sub_y = title_y + 80

    # Draw text with slight shadow for readability
    # Shadow
    draw.text((title_x + 2, title_y + 2), title, fill=(30, 30, 30), font=title_font)
    draw.text((sub_x + 1, sub_y + 1), subtitle, fill=(30, 30, 30), font=subtitle_font)
    # Main text
    draw.text((title_x, title_y), title, fill=CAPTION_COLOR, font=title_font)
    draw.text((sub_x, sub_y), subtitle, fill=SUBTITLE_COLOR, font=subtitle_font)

    # Add a subtle accent line under the caption
    line_y = sub_y + 60
    line_width = 80
    line_x = (TARGET_WIDTH - line_width) // 2
    draw.rectangle(
        [line_x, line_y, line_x + line_width, line_y + 4],
        fill=(59, 130, 246),  # Blue accent (#3B82F6)
    )

    # Save
    canvas.save(output_path, "PNG")
    print(f"  Created: {os.path.basename(output_path)} ({TARGET_WIDTH}x{TARGET_HEIGHT})")


def main():
    parser = argparse.ArgumentParser(description="Frame screenshots for App Store")
    parser.add_argument(
        "--input-dir",
        default="./screenshots",
        help="Directory with raw screenshots (named 01.png through 10.png)",
    )
    parser.add_argument(
        "--output-dir",
        default="./screenshots/framed",
        help="Output directory for framed screenshots",
    )
    args = parser.parse_args()

    input_dir = args.input_dir
    output_dir = args.output_dir

    if not os.path.exists(input_dir):
        print(f"Input directory not found: {input_dir}")
        print(f"\nPlease create it and add your raw screenshots named:")
        for num in CAPTIONS:
            print(f"  {num}.png - {CAPTIONS[num]['title']}")
        print(f"\nAlso accepts .jpg files.")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    print(f"SoccerView App Store Screenshot Framer")
    print(f"=" * 40)
    print(f"Input:  {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Target: {TARGET_WIDTH}x{TARGET_HEIGHT} (iPhone 6.9\")")
    print()

    processed = 0
    for num, caption in CAPTIONS.items():
        # Try both .png and .jpg
        input_path = None
        for ext in [".png", ".jpg", ".jpeg", ".PNG", ".JPG", ".JPEG"]:
            candidate = os.path.join(input_dir, f"{num}{ext}")
            if os.path.exists(candidate):
                input_path = candidate
                break

        if not input_path:
            print(f"  Skipped: {num} - no file found")
            continue

        output_path = os.path.join(output_dir, f"screenshot_{num}.png")
        try:
            frame_screenshot(input_path, output_path, caption)
            processed += 1
        except Exception as e:
            print(f"  Error processing {num}: {e}")

    print(f"\nDone! {processed}/{len(CAPTIONS)} screenshots framed.")
    if processed > 0:
        print(f"Framed screenshots saved to: {output_dir}")
    print(f"\nNext: Upload these to App Store Connect")


if __name__ == "__main__":
    main()
