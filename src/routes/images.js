'use strict';

/**
 * src/routes/images.js
 *
 * GET /api/images
 *
 * Returns the list of predefined images available for graphical
 * password selection. Served without authentication so the register
 * and login pages can load thumbnails before the user signs in.
 *
 * IMPORTANT: The list here is the single source of truth for valid
 * image IDs. The auth routes validate imageId against this list
 * to prevent users from registering with a non-existent image.
 */

const router = require('express').Router();

// This list must stay in sync with the files in public/images/
const IMAGES = [
  {
    id:          'img1',
    name:        'Cybercity',
    description: 'A dark city skyline at night with neon lights and skyscrapers.',
    src:         '/images/img1.svg',
  },
  {
    id:          'img2',
    name:        'Cosmos',
    description: 'A space scene featuring a ringed planet, moon, and satellite.',
    src:         '/images/img2.svg',
  },
  {
    id:          'img3',
    name:        'Circuit',
    description: 'A green circuit board with labelled chips and electronic traces.',
    src:         '/images/img3.svg',
  },
];

// Exported so auth routes can validate imageId server-side
const VALID_IMAGE_IDS = new Set(IMAGES.map(img => img.id));

router.get('/images', (req, res) => {
  return res.json({ images: IMAGES });
});

module.exports = router;
module.exports.VALID_IMAGE_IDS = VALID_IMAGE_IDS;
