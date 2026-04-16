fetch('http://localhost:5000/api/generate-cv', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ currentData: { name: 'Test', title: 'Dev', experience: '1 an' }, jobDescription: 'Dev React' })
})
.then(res => res.text())
.then(txt => console.log('Response:', txt))
.catch(err => console.error(err));
