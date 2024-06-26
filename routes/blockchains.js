require('dotenv').config()
const express = require('express')
const router = express.Router()
const queryTypes = require('../util/queryTypes')
const queryDB = queryTypes.queryDB()

/* GET explore page. */
router.post('/', async function (req, res, next) {
  ip = req.socket.remoteAddress
  if (process.env.SSL_KEY_PATH) {
    ip = req.headers['x-forwarded-for']
  }

  let network = req.body.network;
  let blockchain = "othub_db"

  let query = `select * from blockchains where environment = ?`
  let params = [network]

  network = "";
  let blockchains = await queryDB.getData(query, params, network, blockchain)
    .then(results => {
      //console.log('Query results:', results);
      return results
      // Use the results in your variable or perform further operations
    })
    .catch(error => {
      console.error('Error retrieving data:', error)
    })

  res.json({
    blockchains: blockchains,
    msg: ``
  })
})

module.exports = router