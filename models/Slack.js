const mongoose = require('mongoose')
const mongoosePaginate = require('mongoose-paginate')
const mongooseAutopopulate = require('mongoose-autopopulate')

const noteSchema = new mongoose.Schema(
  {
    note: String,
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      autopopulate: true
    }
  },
  { timestamps: true }
)

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  timestamp: { type: Date, required: true },
  user: {
    id: String,
    name: String,
    real_name: String,
    profile: {
      image_48: String
    }
  },
  attachments: Array,

  mozhelp_user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    autopopulate: true
  }
})

const slackSchema = new mongoose.Schema(
  {
    channel_id: { type: String, required: true },
    team_id: { type: String, required: true },
    messages: [messageSchema],

    mozhelp_status: {
      type: String,
      enum: ['NEW', 'NO_ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETE', 'SENT'],
      default: 'NEW'
    },
    mozhelp_notes: [noteSchema]
  },
  { timestamps: true }
)

slackSchema.plugin(mongooseAutopopulate)
slackSchema.plugin(mongoosePaginate)

slackSchema.statics.SlackMessage = mongoose.model('SlackMessage', messageSchema)
slackSchema.statics.SlackNote = mongoose.model('SlackNote', noteSchema)

const Slack = mongoose.model('Slack', slackSchema)

module.exports = Slack
