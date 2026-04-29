// Minimal Presenter for MVP flows
function MVPPresenter(repo, renderCb) {
  const state = { user: null, exam: null, index: 0, answers: {} };

  function login(username) {
    state.user = repo.login(username);
    renderCb('examList', { user: state.user });
  }

  function listExams() {
    return repo.listExams();
  }

  function startExam(id) {
    const exam = repo.getExam(id);
    if (!exam) return renderCb('error', { message: 'Exam not found' });
    state.exam = exam;
    state.index = 0;
    state.answers = {};
    renderCb('take', { exam: state.exam, index: state.index, answers: state.answers });
  }

  function selectAnswer(qIndex, value) {
    state.answers[qIndex] = value;
  }

  function next() {
    if (!state.exam) return;
    if (state.index < totalQuestions() - 1) state.index++;
    renderCb('take', { exam: state.exam, index: state.index, answers: state.answers });
  }

  function prev() {
    if (!state.exam) return;
    if (state.index > 0) state.index--;
    renderCb('take', { exam: state.exam, index: state.index, answers: state.answers });
  }

  function totalQuestions() {
    if (!state.exam) return 0;
    return state.exam.subjects.reduce((a,s) => a + (s.questions||[]).length, 0);
  }

  function submit() {
    const all = [];
    for (const s of state.exam.subjects) {
      for (const q of s.questions) all.push(q);
    }
    let correct = 0;
    for (let i = 0; i < all.length; i++) {
      const q = all[i];
      const a = state.answers[i];
      if (!a) continue;
      if (a === q.answer) correct++;
    }
    const percent = Math.round((correct / all.length) * 100);
    const submission = { examId: state.exam.id, user: state.user, score: correct, total: all.length, percent, answers: state.answers, submittedAt: new Date().toISOString() };
    repo.saveSubmission(submission);
    renderCb('result', { submission });
  }

  return { login, listExams, startExam, selectAnswer, next, prev, submit, state };
}

window.MVPPresenter = MVPPresenter;
