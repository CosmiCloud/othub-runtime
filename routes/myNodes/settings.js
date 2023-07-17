require('dotenv').config()
var express = require('express')
var router = express.Router()
const purl = require('url')
const keccak256 = require('keccak256')
const mysql = require('mysql')
const { Console } = require('console')
const { Telegraf } = require('telegraf')
const axios = require('axios')

const othubdb_connection = mysql.createConnection({
  host: process.env.DBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASSWORD,
  database: process.env.OTHUB_DB
})

const otp_connection = mysql.createConnection({
  host: process.env.DBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASSWORD,
  database: process.env.SYNC_DB
})

function executeOTHubQuery (query, params) {
  return new Promise((resolve, reject) => {
    othubdb_connection.query(query, params, (error, results) => {
      if (error) {
        reject(error)
      } else {
        resolve(results)
      }
    })
  })
}

async function getOTHubData (query, params) {
  try {
    const results = await executeOTHubQuery(query, params)
    return results
  } catch (error) {
    console.error('Error executing query:', error)
    throw error
  }
}

function executeOTPQuery (query, params) {
  return new Promise((resolve, reject) => {
    otp_connection.query(query, params, (error, results) => {
      if (error) {
        reject(error)
      } else {
        resolve(results)
      }
    })
  })
}

async function getOTPData (query, params) {
  try {
    const results = await executeOTPQuery(query, params)
    return results
  } catch (error) {
    console.error('Error executing query:', error)
    throw error
  }
}

function randomWord (length) {
  let result = ''
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length

  for (let i = 0; i < length; ++i) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }

  return result
}

router.get('/', async function (req, res, next) {
  ip = req.socket.remoteAddress
  if (process.env.SSL_KEY_PATH) {
    ip = req.headers['x-forwarded-for']
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )

  url_params = purl.parse(req.url, true).query
  admin_key = url_params.admin_key
  chain_id = url_params.chain_id
  botToken = url_params.botToken
  telegramID = url_params.telegramID
  group = url_params.group

  nodeRecords = []
  operatorRecord = []

  if (!admin_key) {
    res.json({
      nodeRecords: nodeRecords,
      operatorRecord: operatorRecord,
      msg: ` `
    })
    return
  }

  keccak256hash = keccak256(admin_key).toString('hex')
  keccak256hash = '0x' + keccak256hash
  like_keccak256hash = '%' + keccak256hash + '%'

  query = `select * from v_nodes where current_adminWallet_hashes like ?`
  params = [like_keccak256hash]
  nodeIds = await getOTPData(query, params)
    .then(results => {
      return results
    })
    .catch(error => {
      console.error('Error retrieving data:', error)
    })

  validToken = 'no'
  if (botToken) {
    query =
        'INSERT INTO node_operators (adminKey,botToken) VALUES (?,?) ON DUPLICATE KEY UPDATE botToken = ?'
      await othubdb_connection.query(
        query,
        [admin_key, botToken, botToken],
        function (error, results, fields) {
          if (error) throw error
        }
      )

    response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`)
    .then(results =>{
      return results
    }).catch(error =>{
      console.error('Error checking token:', error)
    });

    if(response){
      validToken = 'yes'
    }
  }

  if(validToken === 'yes'){
      query = `select * from node_operators where adminKey= ?`
      params = [admin_key]
      operatorRecord = await getOTHubData(query, params)
        .then(results => {
          return results
        })
        .catch(error => {
          console.error('Error retrieving data:', error)
        })

      bot = new Telegraf(botToken)
      if(operatorRecord[0].nodeGroup === 'Alliance' && operatorRecord[0].telegramID != ''){
        query = `SELECT * FROM user_header WHERE admin_key = ?`
        params = [admin_key]
        userRecords = await getOTHubData(query, params)
          .then(results => {
            return results
          })
          .catch(error => {
            console.error('Error retrieving data:', error)
          })

          if(userRecords != ''){
            api_key = userRecords[0].api_key
          }else{
            api_key = await randomWord(Math.floor(25) + 5)
            query = `INSERT INTO user_header SET api_key = ?, admin_key = ?, app_name = ?, access = ?`
            await othubdb_connection.query(
              query,
              [api_key, admin_key, 'My Bot', 'Premium'],
              function (error, results, fields) {
                if (error) throw error
              }
            )
          }

        msg =`
        Greetings from OThub.
        
Looks like you've added or changed your bot token. Here are commands to run to install the othub node monitoring script on your node(s):`

        for (i = 0; i < nodeIds.length; ++i) {
          msg = msg + `

<-------Run this for Node ${nodeIds[i].tokenName}------->
wget -O /etc/cron.hourly/node-hourly-monitor https://raw.githubusercontent.com/othub-io/othub-runtime/master/public/scripts/node-monitor-hourly.sh && 
chmod +x /etc/cron.hourly/node-hourly-monitor &&
mkdir -p /etc/othub && 
echo -e "CHAT_ID="${operatorRecord[0].telegramID}" \nBOT_ID="${botToken}" \nNODE_ID="${nodeIds[i].nodeId}" \nAPI_KEY="${api_key}" \nMAX_STORAGE_PERCENT="90"" > /etc/othub/config

          `
        }

        console.log(`Sending Message to users bot.`)
        await bot.telegram.sendMessage(
          operatorRecord[0].telegramID ,
          msg
        )
      }
  }

  if (telegramID) {
    query =
      'INSERT INTO node_operators (adminKey,telegramID) VALUES (?,?) ON DUPLICATE KEY UPDATE telegramID = ?'
    await othubdb_connection.query(
      query,
      [admin_key, telegramID, telegramID],
      function (error, results, fields) {
        if (error) throw error
      }
    )
  }

  query = `select * from node_operators where adminKey= ?`
  params = [admin_key]
  operatorRecord = await getOTHubData(query, params)
    .then(results => {
      return results
    })
    .catch(error => {
      console.error('Error retrieving data:', error)
    })

  if (nodeIds != '' && operatorRecord == '') {
    query =
      'INSERT INTO node_operators (adminKey,keccak256hash,telegramID,botToken,nodeGroup) VALUES (?,?,?,?,?)'
    await othubdb_connection.query(
      query,
      [admin_key, keccak256hash, 'Not Set', 'Not Set', 'Solo'],
      function (error, results, fields) {
        if (error) throw error
      }
    )
  }

  if (group) {
    if (nodeIds == '') {
      res.json({
        nodeRecords: nodeRecords,
        operatorRecord: operatorRecord,
        msg: `You cannot join the Alliance without a V6 Mainnet OTNode.`
      })
      return
    }

    query =
      'INSERT INTO node_operators (adminKey,keccak256hash,nodeGroup) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nodeGroup = ?'
    await othubdb_connection.query(
      query,
      [admin_key, keccak256hash, group, group],
      function (error, results, fields) {
        if (error) throw error
      }
    )
  }

  if (group === 'Alliance') {
    query = `select * from node_operators where adminKey= ?`
    params = [admin_key]
    operatorRecord = await getOTHubData(query, params)
      .then(results => {
        return results
      })
      .catch(error => {
        console.error('Error retrieving data:', error)
      })

    if (operatorRecord[0].botToken) {
      response = await axios.get(`https://api.telegram.org/bot${operatorRecord[0].botToken}/getMe`)
      .then(results =>{
        return results
      }).catch(error =>{
        console.error('Error checking token:', error)
      });

      if(response){
        validToken = 'yes'
      }
    }

    if(validToken === 'yes'){
      bot = new Telegraf(operatorRecord[0].botToken)
      if(operatorRecord[0].telegramID != ''){
        query = `SELECT * FROM user_header WHERE admin_key = ?`
        params = [admin_key]
        userRecords = await getOTHubData(query, params)
          .then(results => {
            return results
          })
          .catch(error => {
            console.error('Error retrieving data:', error)
          })

        if(userRecords != ''){
          api_key = userRecords[0].api_key
        }else{
          api_key = await randomWord(Math.floor(25) + 5)
          query = `INSERT INTO user_header SET api_key = ?, admin_key = ?, app_name = ?, access = ?`
          await othubdb_connection.query(
            query,
            [api_key, admin_key, 'My Bot', 'Premium'],
            function (error, results, fields) {
              if (error) throw error
            }
          )
        }

        msg =`
        Greetings from OThub.
        
Welcome to the Alliance! Here are commands to run to install the othub node monitoring script on your node(s):`

        for (i = 0; i < nodeIds.length; ++i) {
          msg = msg + `

<-------Run this for Node ${nodeIds[i].tokenName}------->
wget -O /etc/cron.hourly/node-hourly-monitor https://raw.githubusercontent.com/othub-io/othub-runtime/master/public/scripts/node-monitor-hourly.sh && 
chmod +x /etc/cron.hourly/node-hourly-monitor && 
mkdir -p /etc/othub &&
echo -e "CHAT_ID="${operatorRecord[0].telegramID}" \nBOT_ID="${operatorRecord[0].botToken}" \nNODE_ID="${nodeIds[i].nodeId}" \nAPI_KEY="${api_key}" \nMAX_STORAGE_PERCENT="90"" > /etc/othub/config

          `
        }

        console.log(`Sending Message to users bot.`)
        await bot.telegram.sendMessage(
          operatorRecord[0].telegramID ,
          msg
        )
      }
    }
  }

  query = `select * from node_operators where adminKey= ?`
  params = [admin_key]
  operatorRecord = await getOTHubData(query, params)
    .then(results => {
      return results
    })
    .catch(error => {
      console.error('Error retrieving data:', error)
    })

  nodeRecords = []
  for (i = 0; i < nodeIds.length; ++i) {
    query = `select * from v_nodes_stats where nodeId=? order by date desc LIMIT 1`
    params = [nodeIds[i].nodeId]
    node_stat = await getOTPData(query, params)
      .then(results => {
        return results
      })
      .catch(error => {
        console.error('Error retrieving data:', error)
      })

    nodeRecords.push(node_stat[0])
  }

  res.json({
    nodeRecords: nodeRecords,
    operatorRecord: operatorRecord,
    msg: ``
  })
  return
})

module.exports = router
