const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const createStorage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Apenas imagens JPG, PNG e WebP são permitidas.'), false);
  }
  cb(null, true);
};

const maxSize = parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024;

const uploadProfile = multer({
  storage: createStorage('profiles'),
  fileFilter: imageFilter,
  limits: { fileSize: maxSize, files: 1 },
});

const uploadPortfolio = multer({
  storage: createStorage('portfolio'),
  fileFilter: imageFilter,
  limits: { fileSize: maxSize, files: 10 },
});

const uploadService = multer({
  storage: createStorage('services'),
  fileFilter: imageFilter,
  limits: { fileSize: maxSize, files: 10 },
});

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: `Arquivo muito grande. Máximo: ${process.env.MAX_FILE_SIZE_MB || 10}MB.` });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ success: false, message: 'Muitos arquivos enviados.' });
  }
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
};

module.exports = { uploadProfile, uploadPortfolio, uploadService, handleUploadError };
