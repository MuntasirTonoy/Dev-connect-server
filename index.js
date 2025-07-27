require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    console.log("✅ Decoded Firebase token:", decodedToken); // <-- ADD THIS LINE
    req.user = decodedToken; // attach user info to req.user
    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err);
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
    app.post("/users", async (req, res) => {
      const { name, email, photoURL } = req.body;
      console.log("line:64", { name, email, photoURL });
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

    // GET /users - fetch all users (protected)
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
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
        const tag = req.query.tag;

        let query = {};
        if (email) query = { authorEmail: email };
        if (tag) {
          query.tag = tag;
        }

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
      console.log("🛠️ Vote route hit!");
      const { id } = req.params;
      const { voteType } = req.body;
      const userEmail = req.user?.email;
      console.log("🔥 Voting user email:", userEmail);

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
        comment.email = req.user.email; // ✅ Add this line
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

    // GET /reported-comments - fetch comments with non-empty feedback
    app.get("/reported-comments", async (req, res) => {
      try {
        const reportedComments = await commentsCollection
          .find({ feedback: { $ne: "" } }) // feedback not equal to empty string
          .sort({ createdAt: -1 })
          .toArray();

        res.json(reportedComments);
      } catch (error) {
        console.error("Error fetching reported comments:", error);
        res.status(500).json({ error: "Failed to fetch reported comments" });
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
            .json({ success: false, message: "Comment not found" });
        }

        // Get the requester user info
        const requester = await usersCollection.findOne({
          email: req.user.email,
        });

        // Only allow comment owner OR admin to delete
        const isOwner = req.user.email === comment.email;
        const isAdmin = requester?.role === "admin";

        if (!isOwner && !isAdmin) {
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
            .json({ success: false, message: "Comment not found" });
        }
      } catch (error) {
        console.error("Error deleting comment:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to delete comment" });
      }
    });

    // patch user role
    app.patch("/users/admin", verifyToken, async (req, res) => {
      const { email, role } = req.body;

      if (!email || !role) {
        return res.status(400).json({ message: "Email and role are required" });
      }

      try {
        // 1. Confirm the requester is an admin
        const requesterEmail = req.user?.email;
        const requester = await usersCollection.findOne({
          email: requesterEmail,
        });

        if (!requester || requester.role !== "admin") {
          return res.status(403).json({ message: "Forbidden - Admins only" });
        }

        // 2. Check if target user exists
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // 3. Avoid redundant updates
        if (user.role === role) {
          return res
            .status(400)
            .json({ message: `User already has role "${role}"` });
        }

        // 4. Update the user role
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role } }
        );

        if (result.modifiedCount > 0) {
          res.json({
            success: true,
            message: `User role updated to "${role}"`,
          });
        } else {
          res.status(500).json({
            success: false,
            message: "Failed to update user role",
          });
        }
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // payment api
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;

      // ✅ Log incoming price
      console.log("Received price for payment intent:", price);

      if (typeof price !== "number" || price <= 0) {
        return res.status(400).json({ error: "Invalid price provided" });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(price * 100), // Stripe expects the amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe error:", error.message);
        res.status(500).json({ error: "Payment intent creation failed" });
      }
    });

    // PATCH /users/payment-status - update user's payment status (protected)
    app.patch("/users/payment-status", verifyToken, async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { paymentStatus: "paid" } }
        );

        if (result.modifiedCount > 0) {
          res.json({
            success: true,
            message: "Payment status updated to paid",
          });
        } else {
          res.status(404).json({
            success: false,
            message: "User not found or already paid",
          });
        }
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).json({ message: "Failed to update payment status" });
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

    // POST /announcements - create announcement (protected, admin only)
    app.post("/announcements", verifyToken, async (req, res) => {
      const { title, message } = req.body;

      if (!title || !message) {
        return res
          .status(400)
          .json({ message: "Title and message are required" });
      }

      try {
        const requesterEmail = req.user.email;
        const user = await usersCollection.findOne({ email: requesterEmail });

        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Forbidden - Admins only" });
        }

        const announcement = {
          title,
          message,
          postedAt: new Date().toISOString(),
          author: {
            name: user.name || "Anonymous",
            image: user.photoURL || "https://i.pravatar.cc/100",
            role: "Admin",
          },
        };

        const result = await announcementsCollection.insertOne(announcement);
        res.status(201).json({
          success: true,
          message: "Announcement created",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("Error creating announcement:", err);
        res.status(500).json({ message: "Failed to create announcement" });
      }
    });
    // DELETE /announcements/:id - admin only
    app.delete("/announcements/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      try {
        const requester = await usersCollection.findOne({
          email: req.user.email,
        });

        if (!requester || requester.role !== "admin") {
          return res.status(403).json({ message: "Forbidden - Admins only" });
        }

        const result = await announcementsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.json({ success: true, message: "Announcement deleted" });
        } else {
          res.status(404).json({ message: "Announcement not found" });
        }
      } catch (error) {
        console.error("Error deleting announcement:", error);
        res.status(500).json({ message: "Internal server error" });
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
