require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@devconnect.2umbcvr.mongodb.net/?retryWrites=true&w=majority&appName=devConnect`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("devConnect");
    const postsCollection = database.collection("posts");
    const usersCollection = database.collection("users");
    const tagsCollection = database.collection("tags");
    const announcementsCollection = database.collection("announcements");

    // PUT /users - Store user if not exists
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
          role: "user", // optional default role
          paymentStatus: "unpaid", // optional default payment status
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

    // POST a new post
    app.post("/posts", async (req, res) => {
      try {
        const postData = req.body;
        const result = await postsCollection.insertOne(postData);
        res.status(201).json(result);
      } catch (error) {
        console.error("Error creating post:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    // get posts
    app.get("/posts", async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};

        if (email) {
          query = { authorEmail: email };
        }

        const posts = await postsCollection.find(query).toArray();
        res.json(posts);
      } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // GET post by ID
    app.get("/posts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const post = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) {
          return res.status(404).json({ error: "Post not found" });
        }
        res.json(post);
      } catch (error) {
        console.error("Error fetching post by ID:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // DELETE a post by ID
    app.delete("/posts/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await postsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Post deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Post not found" });
        }
      } catch (err) {
        console.error("Delete Error:", err); // Log error to terminal
        res.status(500).send({
          success: false,
          message: "Internal server error",
          error: err.message,
        });
      }
    });

    // Update votes
    app.patch("/posts/:id/vote", async (req, res) => {
      const { id } = req.params;
      const { userEmail, voteType } = req.body;

      try {
        const post = await postsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ error: "Post not found" });

        let upVote = post.upVote || [];
        let downVote = post.downVote || [];

        if (voteType === "upvote") {
          // remove from downVote if exists
          downVote = downVote.filter((email) => email !== userEmail);
          // toggle upvote
          if (upVote.includes(userEmail)) {
            upVote = upVote.filter((email) => email !== userEmail);
          } else {
            upVote.push(userEmail);
          }
        } else if (voteType === "downvote") {
          // remove from upVote if exists
          upVote = upVote.filter((email) => email !== userEmail);
          // toggle downvote
          if (downVote.includes(userEmail)) {
            downVote = downVote.filter((email) => email !== userEmail);
          } else {
            downVote.push(userEmail);
          }
        }

        const result = await postsCollection.updateOne(
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

    // tags get api
    app.get("/tags", async (req, res) => {
      try {
        const tags = await tagsCollection.find().toArray();
        res.json(tags);
      } catch (err) {
        console.error("Error fetching tags:", err);
        res.status(500).json({ error: "Failed to fetch tags" });
      }
    });

    // announcement get api
    app.get("/announcements", async (req, res) => {
      try {
        const announcements = await announcementsCollection.find().toArray();
        res.json(announcements);
      } catch (err) {
        console.error("Error fetching announcements:", err);
        res.status(500).json({ error: "Failed to fetch announcements" });
      }
    });

    // Send a ping to confirm a successful connection
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
