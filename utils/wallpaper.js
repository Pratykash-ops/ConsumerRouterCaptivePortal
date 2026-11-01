const fs = require('fs');
const path = require('path');
const multer = require('multer');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

// Ensure public/images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Multer storage for wallpaper uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `custom_${Date.now()}_${cleanBase}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new Error('Only image files (JPG, PNG, GIF, WEBP, SVG) are allowed'));
    }
    cb(null, true);
  }
});

/**
 * Returns available wallpapers from public/images, annotating which one is currently active.
 * @param {string} currentActiveUrl
 */
function getWallpapers(currentActiveUrl = '/images/bg3.jpg') {
  if (!fs.existsSync(IMAGES_DIR)) {
    return [];
  }

  const files = fs.readdirSync(IMAGES_DIR);
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

  const validFiles = files.filter(file => {
    // skip non-image or duplicate extensionless files if extension version exists
    const ext = path.extname(file).toLowerCase();
    if (file === 'bg1' && files.includes('bg1.jpg')) return false;
    return imageExtensions.includes(ext) || file === 'bg1';
  });

  return validFiles.map(file => {
    const url = `/images/${file}`;
    return {
      fileName: file,
      url,
      name: file.replace(/^custom_\d+_/, '').replace(/\.[^/.]+$/, '').toUpperCase(),
      isSelected: url === currentActiveUrl
    };
  });
}

module.exports = {
  upload,
  getWallpapers,
  IMAGES_DIR
};
