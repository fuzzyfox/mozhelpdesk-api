const SlackBot = require('slackbots')
const Slack = require('../models/Slack')

const bots = {}

const botTokens = process.env.SLACK_BOT_TOKEN
  ? process.env.SLACK_BOT_TOKEN.split(',')
  : []

botTokens.forEach(token => {
  const bot = new SlackBot({
    token,
    name: 'MozHelpDesk'
  })

  // HACK we're getting a list of users on connect and assuming the first user's
  //      team id is that of the slack team (should be) and using that to key
  //      the bot too.
  bot.on('open', () => {
    bot.getUsers().then(res => {
      const first = res.members.shift()
      bots[first.team_id] = bot
    })
  })

  bot.on('error', event => {
    console.error('error', event)
  })

  bot.on('message', event => {
    if (
      event.type === 'message' &&
      !event.bot_id &&
      event.channel.slice(0, 1) === 'D'
    ) {
      // On a message search for an existing slack ticket thread
      Slack.findOne(
        {
          channel_id: event.channel,
          team_id: event.team,
          mozhelp_status: {
            $in: ['NEW', 'IN_PROGRESS']
          }
        },
        (err, slack) => {
          if (err) {
            return console.error(err)
          }

          const isNewTicket = !slack

          // If no slack ticket found, create a new one
          if (isNewTicket) {
            slack = new Slack({
              channel_id: event.channel,
              team_id: event.team
            })
          }

          // Get the list of slack users so we can populate the user details
          // on the slack ticket fully
          bot
            .getUsers()
            .catch(console.warn)
            .then(res => {
              const user = res
                ? res.members.find(member => member.id === event.user)
                : {}
              // Push the new message into the slack ticket
              slack.messages.push(
                new Slack.SlackMessage({
                  text: event.text,
                  timestamp: new Date(event.ts * 1000),
                  user: {
                    id: user.id || event.user,
                    name: user.name,
                    real_name: user.real_name,
                    profile: user.profile
                  }
                })
              )

              // Save the slack ticket
              slack.save((err, slack) => {
                if (err) {
                  // socketio emit error
                  return console.error(err)
                }

                // socketio emit save

                if (isNewTicket) {
                  bot.postMessage(
                    slack.channel_id,
                    'Hello human! I’m just a bot, but I’ve notified the #mozhelp team of your need.\n\n' +
                      'One of the lovely #mozhelp humans will be getting back to you soon, but in the mean time, ' +
                      'please make sure you’ve told me everything you can about your issue, and I’ll pass those details along for you.'
                  )
                }
              })
            })
        }
      )
    }
  })
})

module.exports = {
  SlackBot,
  bots
}
