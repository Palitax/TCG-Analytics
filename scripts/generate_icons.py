import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Create image with alpha channel
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    padding = max(1, int(size * 0.08))
    
    # Draw rounded rectangle background (dark navy-grey)
    bg_color = (18, 18, 20, 255) # #121214
    
    try:
        draw.rounded_rectangle([padding, padding, size - padding - 1, size - padding - 1], radius=max(2, int(size * 0.15)), fill=bg_color)
    except AttributeError:
        # Fallback for older Pillow versions
        draw.rectangle([padding, padding, size - padding - 1, size - padding - 1], fill=bg_color)
        
    # Draw a stylized trend line with a neon green color
    line_color = (16, 185, 129, 255) # #10b981
    
    # Coordinates for trend line relative to size
    p1 = (int(size * 0.25), int(size * 0.70))
    p2 = (int(size * 0.50), int(size * 0.60))
    p3 = (int(size * 0.75), int(size * 0.30))
    
    # Draw trend line segments
    width = max(1, int(size * 0.08))
    draw.line([p1, p2, p3], fill=line_color, width=width, joint='round')
    
    # Draw arrowhead at p3
    arrow_size = max(2, int(size * 0.12))
    draw.polygon([
        (p3[0] - arrow_size, p3[1]),
        (p3[0], p3[1]),
        (p3[0], p3[1] + arrow_size)
    ], fill=line_color)
    
    return img

os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    img = create_icon(size)
    img.save(f'icons/icon-{size}.png', 'PNG')
print("Icons generated successfully!")
