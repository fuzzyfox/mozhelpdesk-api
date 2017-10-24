/**
 * @file Slack / ticket endpoint handlers
 */

const express = require('express')
const passport = require('passport')

const router = express.Router()
const Slack = require('../models/Slack')
const slackbots = require('../streams/slack').bots
const stream = require('../stream').slack

// Ensure all endpoints from here on are called with a valid JWT
router.use(passport.authenticate('jwt', { session: false }))

// Get all known slack tickets from the system (paginated)
router.get('/', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Slack.paginate(
    {},
    {
      offset: parseInt(req.query.offset, 10) || 0,
      limit: Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 100))
    },
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(200).json(result)
    }
  )
})

// Get a specific known slack ticket
router.get('/:ticketId', (req, res) => {
  Slack.findById(req.params.ticketId, (err, slackTicket) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!slackTicket) {
      return res.status(404).json({ error: 'Not found' })
    }

    res.status(200).json(slackTicket)
  })
})

// Update a specific known slack ticket
router.patch('/:ticketId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Slack.findById(req.params.ticketId, (err, slackTicket) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!slackTicket) {
      return res.status(404).json({ error: 'Not Found' })
    }

    if (!req.body) {
      return res.status(400).json({ error: 'No Data' })
    }

    const fields = Object.entries(req.body).filter(([name, value]) =>
      ['mozhelp_status'].includes(name)
    )

    fields.forEach(([field, value]) => {
      slackTicket[field] = value
    })

    slackTicket.save(err => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(204).end()

      stream && stream.emit('save', slackTicket)
    })
  })
})

// Reply to  a specific known slack ticket
router.post('/:ticketId/reply', (req, res) => {
  Slack.findById(req.params.ticketId, (err, slackTicket) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!slackTicket) {
      return res.status(404).json({ error: 'Not found' })
    }

    const bot = slackbots[slackTicket.team_id]

    if (!bot) {
      console.log(slackTicket, slackbots)
      return res.status(500).json({ error: 'Not connect to slack team' })
    }

    const message = {
      text: req.body.text
        .replace(/&/gi, '&amp;')
        .replace(/</gi, '&lt;')
        .replace(/>/gi, '&gt;'),
      attachments: [
        {
          author_name: req.user.profile.name,
          author_icon: req.user.profile.picture
        }
      ]
    }

    bot
      .postMessage(slackTicket.channel_id, message.text, {
        attachments: message.attachments
      })
      .then(() => {
        res.status(204).end()

        const slackMessage = new Slack.SlackMessage(message)
        slackMessage.mozhelp_user = req.user.id
        slackMessage.timestamp = Date.now()
        slackTicket.messages.push(slackMessage)

        if (slackTicket.mozhelp_status === 'NEW') {
          slackTicket.mozhelp_status = 'IN_PROGRESS'
        }

        slackTicket.save((err, slackTicket) => {
          if (err) {
            stream && stream.emit('error', err.toString())
            return console.error(err)
          }

          stream && stream.emit('save', slackTicket.toObject())
        })
      })
      .catch(err => {
        console.error(err)
        res.status(500).json({ error: err })
      })
  })
})

// Get notes on a specific known slack ticket
router.get('/:ticketId/notes', (req, res) => {
  Slack.findById(req.params.ticketId, (err, slackTicket) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!slackTicket) {
      return res.status(404).json({ error: 'Not found' })
    }

    res.status(200).json(slackTicket.mozhelp_notes)
  })
})

// Add note to a specific known slack ticket
router.post('/:ticketId/notes', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Slack.findById(req.params.ticketId, (err, slackTicket) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!slackTicket) {
      return res.status(404).json({ error: 'Not found' })
    }

    const note = Slack.SlackNote(req.body)
    note.user = req.user.id
    slackTicket.mozhelp_notes.push(note)

    slackTicket.save((err, slackTicket) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      stream && stream.emit('save', slackTicket.toObject())

      res.status(201).json({ _id: slackTicket.mozhelp_notes.pop().id })
    })
  })
})

// Update a note on a specific known slack ticket
router.put('/:ticketId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Slack.findOne(
    {
      _id: req.params.ticketId,
      'mozhelp_notes._id': req.params.noteId
    },
    (err, slackTicket) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      if (!slackTicket) {
        return res.status(404).json({ error: 'Not found' })
      }

      const note = slackTicket.mozhelp_notes.find(
        note => note.id === req.params.noteId
      )

      if (
        note.user.id !== req.user.id &&
        ['admin', 'wizard'].includes(req.user.role)
      ) {
        return res.status(403).json({ error: 'Incorrect ownership / role' })
      }

      note.note = req.body.note

      slackTicket.save((err, slackTicket) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        stream && stream.emit('save', slackTicket.toObject())

        res.status(204).end()
      })
    }
  )
})

// Delete a note from a specific known slack ticket
router.delete('/:ticketId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Slack.findOne(
    {
      _id: req.params.ticketId,
      'mozhelp_notes._id': req.params.noteId
    },
    (err, slackTicket) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      if (!slackTicket) {
        return res.status(404).json({ error: 'Not found' })
      }

      const note = slackTicket.mozhelp_notes.find(
        note => note.id === req.params.noteId
      )

      if (
        note.user.id !== req.user.id &&
        ['admin', 'wizard'].includes(req.user.role)
      ) {
        return res.status(403).json({ error: 'Incorrect ownership / role' })
      }

      note.remove()

      slackTicket.save((err, slackTicket) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        stream && stream.emit('save', slackTicket.toObject())
        res.status(204).end()
      })
    }
  )
})

module.exports = router
