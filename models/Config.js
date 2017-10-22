const mongoose = require('mongoose')

const schema = new mongoose.Schema({
  name: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
})

schema.statics.init = function() {
  this.findOne({ name: 'stream' }, (err, config) => {
    if (err) {
      return console.error(err)
    }

    if (!config) {
      config = new this({
        name: 'stream',
        value: {
          search_term:
            'mozhelp OR #mozhelp OR @mozhelp OR (mozfest AND help) OR (#mozfest AND help) or (@mozillafestival AND help)',
          user_id: ''
        }
      })

      config.save(err => err && console.error(err))
    }
  })
}

const model = mongoose.model('Config', schema)

module.exports = model
