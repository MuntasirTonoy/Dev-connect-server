require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

// Initialize Firebase Admin with service account JSON file
admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@devconnect.2umbcvr.mongodb.net/?retryWrites=true&w=majority&appName=devConnect`;

// MongoDB client setup
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware to verify Firebase JWT token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // attach user info to req.user
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    res.status(403).json({ message: "Forbidden - Invalid token" });
  }
};

async function run() {
  try {
    await client.connect();

    const database = client.db("devConnect");
    const postsCollection = database.collection("posts");
    const usersCollection = database.collection("users");
    const tagsCollection = database.collection("tags");
    const commentsCollection = database.collection("comments");
    const announcementsCollection = database.collection("announcements");

    // PUT /users - store user if not exists (no auth needed here)
    app.put("/users", async (req, res) => {
      const { name, email, photoURL } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res.status(200).json({ message: "User already exists" });
        }

        const newUser = {
          name,
          email,
          photoURL,
          role: "user",
          paymentStatus: "unpaid",
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res
          .status(201)
          .json({ message: "New user stored", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error in /users:", error);
        res.status(500).json({ message: "Failed to store user" });
      }
    });

    // GET /users/:email - fetch user info by email (protected)
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (error) {
        console.error("Error fetching user by email:", error);
        res.status(500).json({ message: "Failed to fetch user info" });
      }
    });

    // POST /posts - create post (protected)
    app.post("/posts", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const postData = {
          ...req.body,
          authorEmail: user.email,
          author: user.name || "Anonymous",
          authorPhoto: user.picture || "https://via.placeholder.com/150",
          timeOfPost: new Date().toISOString(),
        };

        const result = await postsCollection.insertOne(postData);
        res.status(201).json(result);
      } catch (error) {
        console.error("Error creating post:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // GET posts (optionally by email) - no auth required
    app.get("/posts", async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) query = { authorEmail: email };

        const posts = await postsCollection.find(query).toArray();
        res.json(posts);
      } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // GET post by ID - no auth required
    app.get("/posts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const post = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ error: "Post not found" });
        res.json(post);
      } catch (error) {
        console.error("Error fetching post by ID:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // GET /posts/search?tag=React - no auth required
    app.get("/posts/search", async (req, res) => {
      const { tag } = req.query;
      if (!tag) return res.status(400).json({ error: "Tag is required" });

      try {
        const posts = await postsCollection
          .find({
            tag: { $regex: tag, $options: "i" },
          })
          .sort({ timeOfPost: -1 })
          .toArray();

        res.json(posts);
      } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // DELETE a post by ID (protected)
    app.delete("/posts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      try {
        const post = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) {
          return res
            .status(404)
            .send({ success: false, message: "Post not found" });
        }

        // Optional: Only allow author or admins to delete
        if (req.user.email !== post.authorEmail) {
          return res
            .status(403)
            .json({ message: "Forbidden - Not allowed to delete this post" });
        }

        const result = await postsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Post deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Post not found" });
        }
      } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).send({
          success: false,
          message: "Internal server error",
          error: err.message,
        });
      }
    });

    // PATCH /posts/:id/vote - update votes (protected)
    app.patch("/posts/:id/vote", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { voteType } = req.body;
      const userEmail = req.user.email;

      try {
        const post = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ error: "Post not found" });

        let upVote = post.upVote || [];
        let downVote = post.downVote || [];

        if (voteType === "upvote") {
          downVote = downVote.filter((email) => email !== userEmail);
          if (upVote.includes(userEmail)) {
            upVote = upVote.filter((email) => email !== userEmail);
          } else {
            upVote.push(userEmail);
          }
        } else if (voteType === "downvote") {
          upVote = upVote.filter((email) => email !== userEmail);
          if (downVote.includes(userEmail)) {
            downVote = downVote.filter((email) => email !== userEmail);
          } else {
            downVote.push(userEmail);
          }
        }

        await postsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { upVote, downVote } }
        );

        res.json({
          upVoteCount: upVote.length,
          downVoteCount: downVote.length,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Vote update failed" });
      }
    });

    // GET /tags - no auth required
    app.get("/tags", async (req, res) => {
      try {
        const tags = await tagsCollection.find().toArray();
        res.json(tags);
      } catch (err) {
        console.error("Error fetching tags:", err);
        res.status(500).json({ error: "Failed to fetch tags" });
      }
    });

    // POST /comments - add comment (protected)
    app.post("/comments", verifyToken, async (req, res) => {
      const comment = req.body;

      if (!comment.postId || !comment.message) {
        return res
          .status(400)
          .json({ success: false, message: "Missing required fields" });
      }

      try {
        comment.name = req.user.name || "Anonymous"; // optionally add name from token
        comment.createdAt = new Date();

        const result = await commentsCollection.insertOne(comment);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving comment:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to save comment" });
      }
    });

    // GET /comments/:postId - get comments by post ID - no auth required
    app.get("/comments/:postId", async (req, res) => {
      const postId = req.params.postId;

      try {
        const comments = await commentsCollection
          .find({ postId })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(comments);
      } catch (error) {
        console.error("Error fetching comments:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch comments" });
      }
    });

    // DELETE /comments/:id - delete comment by ID (protected)
    app.delete("/comments/:id", verifyToken, async (req, res) => {
      const commentId = req.params.id;

      try {
        const comment = await commentsCollection.findOne({
          _id: new ObjectId(commentId),
        });
        if (!comment) {
          return res
            .status(404)
            .send({ success: false, message: "Comment not found" });
        }

        // Optional: Only comment owner or admins can delete
        if (req.user.email !== comment.email) {
          return res.status(403).json({
            message: "Forbidden - Not allowed to delete this comment",
          });
        }

        const result = await commentsCollection.deleteOne({
          _id: new ObjectId(commentId),
        });
        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Comment deleted successfully" });
        } else {
          res
            .status(404)
            .send({ success: false, message: "Comment not found" });
        }
      } catch (error) {
        console.error("Error deleting comment:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to delete comment" });
      }
    });

    // PATCH /comments/:id - add feedback to comment (protected)
    app.patch("/comments/:id", verifyToken, async (req, res) => {
      const commentId = req.params.id;
      const { feedback } = req.body;

      if (!feedback) {
        return res.status(400).json({ message: "Feedback is required" });
      }

      try {
        const result = await commentsCollection.updateOne(
          { _id: new ObjectId(commentId) },
          { $set: { feedback } }
        );

        if (result.modifiedCount > 0) {
          res.json({ success: true, message: "Feedback added" });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Comment not found" });
        }
      } catch (err) {
        console.error("Feedback update error:", err);
        res
          .status(500)
          .json({ success: false, message: "Failed to update feedback" });
      }
    });

    // GET /announcements - no auth required
    app.get("/announcements", async (req, res) => {
      try {
        const announcements = await announcementsCollection.find().toArray();
        res.json(announcements);
      } catch (err) {
        console.error("Error fetching announcements:", err);
        res.status(500).json({ error: "Failed to fetch announcements" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.error("❌ Error connecting to MongoDB:", err);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello Tonoy!.... Your server ready");
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
