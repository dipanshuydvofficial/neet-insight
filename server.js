// ============================================================================
// NEET INSIGHT — Test Analysis & Performance Management System
// server.js
// ============================================================================

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');

// ----------------------------------------------------------------------------
// ENV / MONGODB CHECK
// ----------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  console.error('Please set MONGODB_URI in your environment (e.g. Render.com dashboard) before starting the server.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// APP SETUP
// ----------------------------------------------------------------------------

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: 'secret_key_neet',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));

// ----------------------------------------------------------------------------
// MONGOOSE MODELS
// ----------------------------------------------------------------------------

const userSchema = new mongoose.Schema({
  full_name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, default: 'test_09' },
  role: { type: String, enum: ['admin', 'student'], default: 'student' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const testSchema = new mongoose.Schema({
  test_name: { type: String, required: true },
  date: { type: Date, default: Date.now },
  type: { type: String, default: 'Full Syllabus' },
  duration: { type: Number, default: 180 }, // minutes
  total_questions: { type: Number, default: 180 },
  source: { type: String, default: '' }
}, { timestamps: true });

const Test = mongoose.model('Test', testSchema);

const questionSchema = new mongoose.Schema({
  test_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
  question_no: { type: Number, required: true },
  subject: { type: String, default: '' },
  chapter: { type: String, default: '' },
  topic: { type: String, default: '' },
  difficulty: { type: String, default: 'Medium' }, // Easy / Medium / Hard
  correct_answer: { type: String, default: '' },
  student_answer: { type: String, default: '' },
  status: { type: String, enum: ['Correct', 'Wrong', 'Skipped'], default: 'Skipped' },
  confidence: { type: String, default: 'Medium' }, // High / Medium / Low / Guess
  time_taken: { type: Number, default: 0 }, // seconds
  mistake_type: { type: String, default: '' }, // Conceptual / Silly / Calculation / Time Pressure / Guessing / Not Attempted
  notes: { type: String, default: '' }
}, { timestamps: true });

const Question = mongoose.model('Question', questionSchema);

const masterChapterSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  chapter: { type: String, required: true },
  class: { type: String, default: '12' }, // 11 / 12
  weightage: { type: Number, default: 0 } // % weightage in NEET
}, { timestamps: true });

const MasterChapter = mongoose.model('MasterChapter', masterChapterSchema);

const masterTopicSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  chapter: { type: String, required: true },
  topic: { type: String, required: true }
}, { timestamps: true });

const MasterTopic = mongoose.model('MasterTopic', masterTopicSchema);

const mistakeNotebookSchema = new mongoose.Schema({
  test_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Test' },
  date: { type: Date, default: Date.now },
  subject: { type: String, default: '' },
  chapter: { type: String, default: '' },
  topic: { type: String, default: '' },
  question: { type: String, default: '' },
  mistake_type: { type: String, default: '' },
  correct_concept: { type: String, default: '' },
  revision_status: { type: String, enum: ['Pending', 'In Progress', 'Mastered'], default: 'Pending' },
  next_revision_date: { type: Date, default: null }
}, { timestamps: true });

const MistakeNotebook = mongoose.model('MistakeNotebook', mistakeNotebookSchema);

const revisionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  question_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
  due_date: { type: Date, required: true },
  status: { type: String, enum: ['Due', 'Completed', 'Skipped'], default: 'Due' }
}, { timestamps: true });

const Revision = mongoose.model('Revision', revisionSchema);

const progressSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  metrics_json: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const Progress = mongoose.model('Progress', progressSchema);

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  type: { type: String, default: 'info' }, // info / warning / success / danger
  created_at: { type: Date, default: Date.now }
});

const Notification = mongoose.model('Notification', notificationSchema);

// ----------------------------------------------------------------------------
// MONGOOSE CONNECTION + DEFAULT ADMIN SEED
// ----------------------------------------------------------------------------

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully.');
    await seedDefaultAdmin();
    app.listen(PORT, () => {
      console.log(`NEET Insight server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

async function seedDefaultAdmin() {
  try {
    const existingAdmin = await User.findOne({ email: 'dipanshuydvofficial@gmail.com' });
    if (!existingAdmin) {
      await User.create({
        full_name: 'Administrator',
        email: 'dipanshuydvofficial@gmail.com',
        password: 'dy2009,dy2009',
        role: 'admin'
      });
      console.log('Default admin account created.');
    }
  } catch (err) {
    console.error('Error seeding default admin:', err.message);
  }
}

// ----------------------------------------------------------------------------
// MIDDLEWARE
// ----------------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ----------------------------------------------------------------------------
// ANALYTICS HELPERS
// ----------------------------------------------------------------------------

// Marking scheme: correct = +4, wrong = -1, skipped = 0
// negative marks = wrong count x 1 (magnitude of marks lost to negative marking)
// opportunity loss = wrong count x 5 (the 4 they could've earned + the 1 they lost)
function computeScoreMetrics(questions) {
  let correct = 0, wrong = 0, skipped = 0;

  questions.forEach(q => {
    if (q.status === 'Correct') correct++;
    else if (q.status === 'Wrong') wrong++;
    else skipped++;
  });

  const total = questions.length;
  const attempted = correct + wrong;
  const score = (correct * 4) - (wrong * 1);
  const negative_marks = wrong * 1;
  const opportunity_loss = wrong * 5;
  const accuracy = attempted > 0 ? ((correct / attempted) * 100) : 0;
  const predicted_score = score;

  return {
    total,
    correct,
    wrong,
    skipped,
    attempted,
    score,
    negative_marks,
    opportunity_loss,
    accuracy: Math.round(accuracy * 100) / 100,
    predicted_score
  };
}

function getRevisionDueDates(fromDate) {
  const base = new Date(fromDate);
  const intervals = [1, 3, 7, 15, 30, 60];
  return intervals.map(days => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  });
}

async function createRevisionSchedule(userId, questionId, fromDate) {
  const dueDates = getRevisionDueDates(fromDate);
  const revisionDocs = dueDates.map(due_date => ({
    user_id: userId,
    question_id: questionId,
    due_date,
    status: 'Due'
  }));
  await Revision.insertMany(revisionDocs);
}

// ----------------------------------------------------------------------------
// AUTH ROUTES
// ----------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.redirect('/app?page=dashboard');
});

app.get('/login', (req, res) => {
  const error = req.query.error || null;
  res.render('login', { error });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid credentials'));
    }

    const normalizedEmail = email.trim().toLowerCase();
    const foundUser = await User.findOne({ email: normalizedEmail });

    if (!foundUser || foundUser.password !== password) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid credentials'));
    }

    req.session.user = {
      _id: foundUser._id,
      full_name: foundUser.full_name,
      email: foundUser.email,
      role: foundUser.role
    };

    res.redirect('/app?page=dashboard');
  } catch (err) {
    console.error('Login error:', err.message);
    res.redirect('/login?error=' + encodeURIComponent('Invalid credentials'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ----------------------------------------------------------------------------
// SINGLE APP HANDLER (GET + POST)
// ----------------------------------------------------------------------------

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

async function appHandler(req, res) {
  try {
    const params = req.method === 'POST' ? req.body : req.query;
    const page = params.page || req.query.page || 'dashboard';
    let msg = req.query.msg || null;
    const user = req.session.user;

    // ------------------------------------------------------------------
    // POST ACTIONS
    // ------------------------------------------------------------------
    if (req.method === 'POST' && params.action) {
      const action = params.action;

      // ---------------- CREATE TEST ----------------
      if (action === 'create_test') {
        const newTest = await Test.create({
          test_name: params.test_name || 'Untitled Test',
          date: params.date ? new Date(params.date) : new Date(),
          type: params.type || 'Full Syllabus',
          duration: params.duration ? Number(params.duration) : 180,
          total_questions: params.total_questions ? Number(params.total_questions) : 180,
          source: params.source || ''
        });

        return res.redirect(`/app?page=test_detail&test_id=${newTest._id}&msg=${encodeURIComponent('Test created successfully')}`);
      }

      // ---------------- SAVE QUESTIONS (bulk) ----------------
      if (action === 'save_questions') {
        const test_id = params.test_id;
        if (!test_id) {
          return res.redirect('/app?page=tests&msg=' + encodeURIComponent('Missing test reference'));
        }

        let questionsPayload = [];
        try {
          questionsPayload = typeof params.questions_json === 'string'
            ? JSON.parse(params.questions_json)
            : (params.questions || []);
        } catch (e) {
          questionsPayload = [];
        }

        if (!Array.isArray(questionsPayload)) questionsPayload = [questionsPayload];

        for (const q of questionsPayload) {
          if (!q || !q.question_no) continue;

          const filter = { test_id: test_id, question_no: Number(q.question_no) };
          const update = {
            test_id: test_id,
            question_no: Number(q.question_no),
            subject: q.subject || '',
            chapter: q.chapter || '',
            topic: q.topic || '',
            difficulty: q.difficulty || 'Medium',
            correct_answer: q.correct_answer || '',
            student_answer: q.student_answer || '',
            status: q.status || 'Skipped',
            confidence: q.confidence || 'Medium',
            time_taken: q.time_taken ? Number(q.time_taken) : 0,
            mistake_type: q.mistake_type || '',
            notes: q.notes || ''
          };

          const savedQuestion = await Question.findOneAndUpdate(
            filter,
            update,
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          // ---------------- AUTO MISTAKE NOTEBOOK ----------------
          if (savedQuestion.status === 'Wrong') {
            const existingMistake = await MistakeNotebook.findOne({
              test_id: test_id,
              question: String(savedQuestion.question_no)
            });

            let mistakeDoc;
            if (!existingMistake) {
              mistakeDoc = await MistakeNotebook.create({
                test_id: test_id,
                date: new Date(),
                subject: savedQuestion.subject,
                chapter: savedQuestion.chapter,
                topic: savedQuestion.topic,
                question: String(savedQuestion.question_no),
                mistake_type: savedQuestion.mistake_type || 'Not Specified',
                correct_concept: '',
                revision_status: 'Pending',
                next_revision_date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })()
              });
            } else {
              existingMistake.subject = savedQuestion.subject;
              existingMistake.chapter = savedQuestion.chapter;
              existingMistake.topic = savedQuestion.topic;
              existingMistake.mistake_type = savedQuestion.mistake_type || existingMistake.mistake_type;
              await existingMistake.save();
              mistakeDoc = existingMistake;
            }

            // ---------------- REVISION ENGINE ----------------
            const existingRevisions = await Revision.findOne({ question_id: savedQuestion._id });
            if (!existingRevisions) {
              await createRevisionSchedule(user._id, savedQuestion._id, new Date());
            }
          }
        }

        return res.redirect(`/app?page=test_detail&test_id=${test_id}&msg=${encodeURIComponent('Questions saved successfully')}`);
      }

      // ---------------- UPDATE MISTAKE ----------------
      if (action === 'update_mistake') {
        const mistake_id = params.mistake_id;
        if (mistake_id) {
          const updateFields = {};
          if (params.revision_status) updateFields.revision_status = params.revision_status;
          if (params.correct_concept !== undefined) updateFields.correct_concept = params.correct_concept;
          if (params.next_revision_date) updateFields.next_revision_date = new Date(params.next_revision_date);

          await MistakeNotebook.findByIdAndUpdate(mistake_id, updateFields);
        }
        return res.redirect(`/app?page=mistakes&msg=${encodeURIComponent('Mistake updated successfully')}`);
      }

      // ---------------- UPDATE REVISION STATUS ----------------
      if (action === 'update_revision') {
        const revision_id = params.revision_id;
        if (revision_id) {
          await Revision.findByIdAndUpdate(revision_id, { status: params.status || 'Completed' });
        }
        return res.redirect(`/app?page=revision&msg=${encodeURIComponent('Revision updated successfully')}`);
      }

      // ---------------- ADD MASTER CHAPTER ----------------
      if (action === 'add_chapter') {
        await MasterChapter.create({
          subject: params.subject || '',
          chapter: params.chapter || '',
          class: params.class || '12',
          weightage: params.weightage ? Number(params.weightage) : 0
        });
        return res.redirect(`/app?page=analytics&msg=${encodeURIComponent('Chapter added successfully')}`);
      }

      // ---------------- ADD MASTER TOPIC ----------------
      if (action === 'add_topic') {
        await MasterTopic.create({
          subject: params.subject || '',
          chapter: params.chapter || '',
          topic: params.topic || ''
        });
        return res.redirect(`/app?page=analytics&msg=${encodeURIComponent('Topic added successfully')}`);
      }

      // ---------------- DELETE TEST ----------------
      if (action === 'delete_test') {
        const test_id = params.test_id;
        if (test_id) {
          await Question.deleteMany({ test_id });
          await Test.findByIdAndDelete(test_id);
        }
        return res.redirect(`/app?page=tests&msg=${encodeURIComponent('Test deleted successfully')}`);
      }

      // Unknown action fallthrough
      return res.redirect(`/app?page=${page}`);
    }

    // ------------------------------------------------------------------
    // GET DATA (ALWAYS LOADED)
    // ------------------------------------------------------------------

    const allTests = await Test.find().sort({ date: -1 }).lean();
    const allQuestions = await Question.find().lean();

    const data = {
      user: user,
      page: page,
      msg: msg,
      tests: allTests,
      questions: allQuestions,
      test_id: null
    };

    // ------------------------------------------------------------------
    // PAGE-SPECIFIC DATA
    // ------------------------------------------------------------------

    if (page === 'dashboard') {
      const metrics = computeScoreMetrics(allQuestions);
      data.total_tests = allTests.length;
      data.total_questions = allQuestions.length;
      data.accuracy = metrics.accuracy;
      data.negative_marks = metrics.negative_marks;
      data.opportunity_loss = metrics.opportunity_loss;
      data.predicted_score = metrics.predicted_score;
      data.correct = metrics.correct;
      data.wrong = metrics.wrong;
      data.skipped = metrics.skipped;

      // Accuracy trend across tests (chronological)
      const trendTests = [...allTests].sort((a, b) => new Date(a.date) - new Date(b.date));
      const accuracyTrend = [];
      for (const t of trendTests) {
        const tQuestions = allQuestions.filter(q => String(q.test_id) === String(t._id));
        if (tQuestions.length === 0) continue;
        const m = computeScoreMetrics(tQuestions);
        accuracyTrend.push({
          test_name: t.test_name,
          date: t.date,
          accuracy: m.accuracy,
          score: m.score
        });
      }
      data.accuracy_trend = accuracyTrend;

      // Subject performance
      const subjectMap = {};
      allQuestions.forEach(q => {
        const subj = q.subject || 'Unassigned';
        if (!subjectMap[subj]) subjectMap[subj] = [];
        subjectMap[subj].push(q);
      });
      data.subject_performance = Object.keys(subjectMap).map(subj => {
        const m = computeScoreMetrics(subjectMap[subj]);
        return { subject: subj, ...m };
      });

      // Mistake distribution
      const mistakeMap = {};
      allQuestions.filter(q => q.status === 'Wrong').forEach(q => {
        const mt = q.mistake_type || 'Not Specified';
        mistakeMap[mt] = (mistakeMap[mt] || 0) + 1;
      });
      data.mistake_distribution = Object.keys(mistakeMap).map(k => ({ mistake_type: k, count: mistakeMap[k] }));
    }

    if (page === 'tests') {
      data.tests_with_metrics = allTests.map(t => {
        const tQuestions = allQuestions.filter(q => String(q.test_id) === String(t._id));
        const m = computeScoreMetrics(tQuestions);
        return { ...t, metrics: m };
      });
    }

    if (page === 'test_detail') {
      const test_id = req.query.test_id || params.test_id;
      data.test_id = test_id;
      if (test_id) {
        data.current_test = await Test.findById(test_id).lean();
        const testQuestions = allQuestions.filter(q => String(q.test_id) === String(test_id))
          .sort((a, b) => a.question_no - b.question_no);
        data.test_questions = testQuestions;
        data.test_metrics = computeScoreMetrics(testQuestions);

        // subject-wise breakdown for this test
        const subjMap = {};
        testQuestions.forEach(q => {
          const subj = q.subject || 'Unassigned';
          if (!subjMap[subj]) subjMap[subj] = [];
          subjMap[subj].push(q);
        });
        data.test_subject_breakdown = Object.keys(subjMap).map(subj => {
          const m = computeScoreMetrics(subjMap[subj]);
          return { subject: subj, ...m };
        });
      } else {
        data.current_test = null;
        data.test_questions = [];
        data.test_metrics = computeScoreMetrics([]);
        data.test_subject_breakdown = [];
      }
    }

    if (page === 'analytics') {
      data.master_chapters = await MasterChapter.find().lean();
      data.master_topics = await MasterTopic.find().lean();

      // Subject-level analysis
      const subjectMap = {};
      allQuestions.forEach(q => {
        const subj = q.subject || 'Unassigned';
        if (!subjectMap[subj]) subjectMap[subj] = [];
        subjectMap[subj].push(q);
      });
      data.subject_analysis = Object.keys(subjectMap).map(subj => {
        const m = computeScoreMetrics(subjectMap[subj]);
        return { subject: subj, ...m };
      });

      // Chapter-level analysis
      const chapterMap = {};
      allQuestions.forEach(q => {
        const key = (q.subject || 'Unassigned') + ' | ' + (q.chapter || 'Unassigned');
        if (!chapterMap[key]) chapterMap[key] = { subject: q.subject || 'Unassigned', chapter: q.chapter || 'Unassigned', questions: [] };
        chapterMap[key].questions.push(q);
      });
      data.chapter_analysis = Object.values(chapterMap).map(c => {
        const m = computeScoreMetrics(c.questions);
        return { subject: c.subject, chapter: c.chapter, ...m };
      });

      // Topic-level analysis
      const topicMap = {};
      allQuestions.forEach(q => {
        const key = (q.subject || 'Unassigned') + ' | ' + (q.chapter || 'Unassigned') + ' | ' + (q.topic || 'Unassigned');
        if (!topicMap[key]) topicMap[key] = { subject: q.subject || 'Unassigned', chapter: q.chapter || 'Unassigned', topic: q.topic || 'Unassigned', questions: [] };
        topicMap[key].questions.push(q);
      });
      data.topic_analysis = Object.values(topicMap).map(t => {
        const m = computeScoreMetrics(t.questions);
        return { subject: t.subject, chapter: t.chapter, topic: t.topic, ...m };
      });
    }

    if (page === 'mistakes') {
      data.mistakes = await MistakeNotebook.find().sort({ date: -1 }).lean();
    }

    if (page === 'revision') {
      const now = new Date();
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const allRevisions = await Revision.find().populate('question_id').sort({ due_date: 1 }).lean();

      data.due_today = allRevisions.filter(r => r.status === 'Due' && new Date(r.due_date) >= todayStart && new Date(r.due_date) <= todayEnd);
      data.overdue = allRevisions.filter(r => r.status === 'Due' && new Date(r.due_date) < todayStart);
      data.upcoming = allRevisions.filter(r => r.status === 'Due' && new Date(r.due_date) > todayEnd);
      data.completed = allRevisions.filter(r => r.status === 'Completed');
    }

    if (page === 'progress') {
      const trendTests = [...allTests].sort((a, b) => new Date(a.date) - new Date(b.date));
      const fullTrend = [];
      for (const t of trendTests) {
        const tQuestions = allQuestions.filter(q => String(q.test_id) === String(t._id));
        if (tQuestions.length === 0) continue; // skip tests with no questions entered yet
        const m = computeScoreMetrics(tQuestions);
        fullTrend.push({
          test_name: t.test_name,
          date: t.date,
          accuracy: m.accuracy,
          score: m.score,
          negative_marks: m.negative_marks,
          opportunity_loss: m.opportunity_loss
        });
      }
      data.progress_trend = fullTrend;

      // Weekly aggregation
      const weekMap = {};
      fullTrend.forEach(entry => {
        const d = new Date(entry.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = weekStart.toISOString().slice(0, 10);
        if (!weekMap[key]) weekMap[key] = [];
        weekMap[key].push(entry);
      });
      data.weekly_progress = Object.keys(weekMap).sort().map(key => {
        const entries = weekMap[key];
        const avgAccuracy = entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length;
        const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
        return { week: key, avg_accuracy: Math.round(avgAccuracy * 100) / 100, avg_score: Math.round(avgScore * 100) / 100, tests: entries.length };
      });

      // Monthly aggregation
      const monthMap = {};
      fullTrend.forEach(entry => {
        const d = new Date(entry.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) monthMap[key] = [];
        monthMap[key].push(entry);
      });
      data.monthly_progress = Object.keys(monthMap).sort().map(key => {
        const entries = monthMap[key];
        const avgAccuracy = entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length;
        const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
        const [yearPart, monthPart] = key.split('-');
        const monthLabel = new Date(Number(yearPart), Number(monthPart) - 1, 1)
          .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        return { month: key, month_label: monthLabel, avg_accuracy: Math.round(avgAccuracy * 100) / 100, avg_score: Math.round(avgScore * 100) / 100, tests: entries.length };
      });

      // Save/update progress snapshot for this user
      await Progress.findOneAndUpdate(
        { user_id: user._id },
        { user_id: user._id, metrics_json: { weekly: data.weekly_progress, monthly: data.monthly_progress, trend: fullTrend } },
        { upsert: true }
      );
    }

    res.render('app', data);

  } catch (err) {
    console.error('appHandler error:', err.message);
    res.render('app', {
      user: req.session.user,
      page: 'dashboard',
      msg: 'An error occurred: ' + err.message,
      tests: [],
      questions: [],
      test_id: null,
      total_tests: 0,
      total_questions: 0,
      accuracy: 0,
      negative_marks: 0,
      opportunity_loss: 0,
      predicted_score: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      accuracy_trend: [],
      subject_performance: [],
      mistake_distribution: []
    });
  }
}

// ----------------------------------------------------------------------------
// 404 HANDLER
// ----------------------------------------------------------------------------

app.use((req, res) => {
  res.redirect('/app?page=dashboard');
});
