const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let twitterDB = null;
const initializeDBAndServer = async () => {
  try {
    twitterDB = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000);
  } catch (e) {
    process.exit(1);
  }
};
initializeDBAndServer();

convertDbObjectToResponseObject = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "twitter_clone", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const getUserId = async (request, response, next) => {
  const { username } = request;
  const getUserId = `
        SELECT 
          user_id FROM user 
        WHERE username = '${username}';`;

  const userId = await twitterDB.all(getUserId);
  request.userId = userId;
  next();
};

const authenticateUserFollowing = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getFollowingsQuery = `

  SELECT 
    following_user_id 
        FROM 
            follower 
        WHERE 
            follower_user_id ='${userId[0].user_id}'
  INTERSECT
    SELECT
        user_id
            FROM 
                tweet 
            WHERE
                tweet_id='${tweetId}';`;

  const listOfFollowings = await twitterDB.all(getFollowingsQuery);

  if (listOfFollowings.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API 1 to Register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await twitterDB.get(selectUserQuery);
  if (userDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUsersQuery = `
        INSERT INTO
            user(username,password,name,gender)
        VALUES (
            '${username}',            
            '${hashedPassword}',
            '${name}',
            '${gender}'            
        );`;
      await twitterDB.run(createUsersQuery);
      response.send("User created successfully");
    }
  }
});

//API 2 for login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await twitterDB.get(selectUserQuery);
  if (userDetails === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatch = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordMatch === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "twitter_clone");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3 to get followers tweets feed
app.get(
  "/user/tweets/feed/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;

    const getFollowerTweetsQuery = `
  SELECT
      username,
      tweet,
      date_time
    FROM
      user NATURAL JOIN tweet
    WHERE 
      user_id IN (
          SELECT
            following_user_id 
          FROM 
            follower 
          WHERE 
            follower_user_id=${userId[0].user_id})
    ORDER BY date_time DESC
    LIMIT 4;`;

    const listOfFollowersTweets = await twitterDB.all(getFollowerTweetsQuery);
    response.send(
      listOfFollowersTweets.map((dbObj) =>
        convertDbObjectToResponseObject(dbObj)
      )
    );
  }
);

//API 4 to get following
app.get(
  "/user/following/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;

    const getFollowingsQuery = `
  SELECT
      name
    FROM
      user
    WHERE 
      user_id IN (
          SELECT
            following_user_id 
          FROM 
            follower 
          WHERE 
            follower_user_id=${userId[0].user_id});`;

    const listOfFollowings = await twitterDB.all(getFollowingsQuery);

    response.send(listOfFollowings);
  }
);

//API 5 to get followers
app.get(
  "/user/followers/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;
    const getFollowersQuery = `
  SELECT
      name
    FROM
      user
    WHERE 
      user_id IN (
          SELECT
            follower_user_id 
          FROM 
            follower 
          WHERE 
            following_user_id=${userId[0].user_id});`;

    const listOfFollowers = await twitterDB.all(getFollowersQuery);
    response.send(listOfFollowers);
  }
);

//API 6 to get tweetId
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  authenticateUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetsLikeReplyQuery = `
    SELECT 
        tweet,
        COUNT( DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        date_time
    FROM
      (
        tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
      ) AS T INNER JOIN reply ON T.tweet_id = reply.tweet_id
    WHERE
      tweet.tweet_id = '${tweetId}' ;`;

    const getTweetsLikeReply = await twitterDB.get(getTweetsLikeReplyQuery);
    response.send({
      tweet: getTweetsLikeReply.tweet,
      likes: getTweetsLikeReply.likes,
      replies: getTweetsLikeReply.replies,
      dateTime: getTweetsLikeReply.date_time,
    });
  }
);

//API 7 to get tweetId
app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  getUserId,
  authenticateUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetsLikeReplyQuery = `
    SELECT 
        DISTINCT user.username       
    FROM 
       (
        follower INNER JOIN like ON following_user_id = user_id
      )
      AS T INNER JOIN user ON T.user_id = user.user_id
    WHERE 
      tweet_id = '${tweetId}' ;`;

    const getTweetsLikeReply = await twitterDB.all(getTweetsLikeReplyQuery);
    const likes = [];
    for (let value of getTweetsLikeReply) {
      likes.push(value.username);
    }
    response.send({ likes: likes });
  }
);

//API 8 to get tweetId
app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  getUserId,
  authenticateUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetsLikeReplyQuery = `
    SELECT 
        DISTINCT name,
        reply
    FROM
      (
        follower INNER JOIN reply ON following_user_id = user_id
      ) AS T INNER JOIN user ON T.user_id = user.user_id
    WHERE 
      tweet_id = '${tweetId}' ;`;

    const getTweetsLikeReply = await twitterDB.all(getTweetsLikeReplyQuery);
    response.send({ replies: getTweetsLikeReply });
  }
);

//API 9 to get user tweets
app.get(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;

    const getTweetsLikeReplyQuery = `
    SELECT 
      tweet,
      COUNT( DISTINCT like_id) AS likes,
      COUNT(DISTINCT reply_id) AS replies,
      date_time
    FROM
      (
        tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
      ) AS T INNER JOIN reply ON T.tweet_id = reply.tweet_id
    WHERE 
      tweet.user_id = '${userId[0].user_id}'
    GROUP BY
      tweet ;`;

    const getTweetsLikeReply = await twitterDB.all(getTweetsLikeReplyQuery);
    response.send(
      getTweetsLikeReply.map((dbObj) => ({
        tweet: dbObj.tweet,
        likes: dbObj.likes,
        replies: dbObj.replies,
        dateTime: dbObj.date_time,
      }))
    );
  }
);

//API 10 to create user tweets
app.post(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;
    const { tweet } = request.body;
    const getDate = await twitterDB.get(`SELECT datetime()`);

    tweetDate = Object.values(getDate)[0];

    const getTweetsLikeReplyQuery = `
    INSERT INTO
     tweet(tweet,user_id,date_time)
    VALUES('${tweet}','${userId[0].user_id}','${tweetDate}')`;

    await twitterDB.run(getTweetsLikeReplyQuery);
    response.send("Created a Tweet");
  }
);

//API 11 to delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const getTweetUserIdQuery = `
        SELECT
             *
        FROM
           user NATURAL JOIN tweet
        WHERE user_id=${userId[0].user_id} AND tweet_id=${tweetId};`;

    const getTweetUserId = await twitterDB.all(getTweetUserIdQuery);
    const isEmpty = getTweetUserId.length === 0;

    if (isEmpty) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
           DELETE
            FROM
              tweet WHERE tweet_id = ${tweetId} ;`;

      await twitterDB.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
