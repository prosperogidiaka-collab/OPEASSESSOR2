// Simple in-memory repository (MVP)
const MVPRepo = (function(){
  let exams = [];

  function seed() {
    try {
      if (typeof getAllQuizzes === 'function') {
        const g = getAllQuizzes();
        exams = Object.keys(g).map(k => g[k]);
      }
    } catch (e) {
      // ignore
    }

    if (!exams || exams.length === 0) {
      // fallback sample exam
      exams = [{
        id: '000001',
        title: 'Sample Math Quiz',
        timeLimit: 10,
        maxGrade: 100,
        subjects: [{ name: 'Math', questions: [
          { question: 'What is 2+2?', options: ['3','4','5','6'], answer: 'B' },
          { question: 'What is 3*3?', options: ['6','8','9','12'], answer: 'C' }
        ] }]
      }];
    }
  }

  function listExams() { return exams.map(e => ({ id: e.id, title: e.title, timeLimit: e.timeLimit || 0 })); }
  function getExam(id) { return exams.find(x => x.id == id); }
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

  seed();

  return { listExams, getExam, login, saveSubmission, generateShortLink };
})();

window.MVPRepo = MVPRepo;
