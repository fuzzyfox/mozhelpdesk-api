const express = require('express')

const router = express.Router()

router.get('/healthcheck', (req, res) => {
  res.status(200).json({
    http: 'okay'
  })
})

module.exports = router
