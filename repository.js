// Simple in-memory repository (MVP)
// repository.js is loaded before app.js, so seed() must defer reading
// getAllQuizzes until each call rather than at script-eval time.
const MVPRepo = (function(){
  const FALLBACK_EXAMS = [{
    id: '000001',
    title: 'Sample Math Quiz',
    timeLimit: 10,
    maxGrade: 100,
    subjects: [{ name: 'Math', questions: [
      { question: 'What is 2+2?', options: ['3','4','5','6'], answer: 'B' },
      { question: 'What is 3*3?', options: ['6','8','9','12'], answer: 'C' }
    ] }]
  }];

  function readExams() {
    try {
      if (typeof getAllQuizzes === 'function') {
        const g = getAllQuizzes() || {};
        const list = Object.keys(g).map(k => g[k]);
        if (list.length) return list;
      }
    } catch (e) { /* ignore */ }
    return FALLBACK_EXAMS;
  }

  function listExams() { return readExams().map(e => ({ id: e.id, title: e.title, timeLimit: e.timeLimit || 0 })); }
  function getExam(id) { return readExams().find(x => x.id == id); }
  function generateShortLink(id) {
    try {
      const base = window.location.origin + window.location.pathname;
      return `${base}?m=${encodeURIComponent(id)}`;
    } catch (e) { return `?m=${id}`; }
  }
  function login(username) { return { username }; }
  function saveSubmission(sub) {
    try {
      const key = 'mvp_submissions_v1';
      const cur = JSON.parse(localStorage.getItem(key) || '[]');
      cur.push(sub);
      localStorage.setItem(key, JSON.stringify(cur));
    } catch (e) { console.warn('saveSubmission failed', e); }
  }

  return { listExams, getExam, login, saveSubmission, generateShortLink };
})();

window.MVPRepo = MVPRepo;
