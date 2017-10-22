/**
 * @file Public endpoint handlers
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const express = require('express')

const router = express.Router()

// simple healthcheck route to ping
router.get('/healthcheck', (req, res) => {
  res.status(200).json({
    http: 'okay'
  })
})

module.exports = router
