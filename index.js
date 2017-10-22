const bodyParser = require('body-parser')
const dotenv = require('dotenv')
const errorhandler = require('errorhandler')
const express = require('express')
const expressNunjucks = require('express-nunjucks')
const expressSession = require('express-session')
const expressStatusMonitor = require('express-status-monitor')
const lusca = require('lusca')
const mongoose = require('mongoose')
const morgan = require('morgan')
const path = require('path')
const passport = require('passport')
const cors = require('cors')

dotenv.load({ path: '.env' })

// Connect to mongodb
mongoose.Promise = global.Promise
mongoose.connect(process.env.MONGODB_URI, { useMongoClient: true })
mongoose.connection.on('error', err => {
  console.log('MongoDB Conenction Error')
  console.error(err)
  process.exit()
})

// Init config if needed
require('./models/Config').init()

// Run passport configuration
require('./passport/twitter')
require('./passport/jwt')

// Create the express app
const app = express()
const http = require('http').Server(app)

// Configure stream/socketio
require('./stream').init(http)

// Cache some data on the app singleton
app.set('host', process.env.HOST || '0.0.0.0')
app.set('port', process.env.PORT || 3000)
app.set('views', path.join(__dirname, 'views'))

// Express configuration
app.use(cors())
app.use(
  expressSession({
    secret: process.env.SESSION_SECRET || 'irrelephant',
    resave: false,
    saveUninitialized: false
  })
)
app.use(expressStatusMonitor())
app.use(morgan('dev'))
app.use(bodyParser.json())
app.use(passport.initialize())
app.use(lusca.xframe('DENY'))
app.use(lusca.xssProtection(true))
app.use(lusca.nosniff())
app.use(lusca.hsts({ maxAge: 31536000 }))

// Nunjucks configuration
expressNunjucks(app, {
  watch: process.env.NODE_ENV !== 'production',
  noCache: process.env.NODE_ENV !== 'production'
})

// Routes
app.use('/static', express.static('public'))
app.use('/auth', require('./routes/auth'))
app.use('/', require('./routes/index'))
app.use('/users', require('./routes/users'))
app.use('/twitter', require('./routes/twitter'))
app.use('/tweets', require('./routes/tweets'))
app.use('/stream', require('./routes/stream'))

// Error handling
app.use(errorhandler())

// Listening
http.listen(app.get('port'), () => {
  console.log(`Listening on port ${app.get('port')}`)
  console.log(`Running as ${process.env.NODE_ENV}`)
})
