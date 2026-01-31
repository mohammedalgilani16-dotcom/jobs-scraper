const express = require('express');
const app = express();

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json());

// Mock job data
const jobsDatabase = [
  {
    id: '1',
    title: 'Senior Software Engineer',
    company: 'Tech Corp',
    location: 'San Francisco, CA',
    salary: '$150,000 - $200,000',
    description: 'Looking for senior software engineer with 5+ years experience in JavaScript, React, and Node.js.',
    fullDescription: 'We are seeking a Senior Software Engineer to join our growing team. You will be responsible for designing, developing, and maintaining our web applications. Requirements: 5+ years of experience, proficiency in JavaScript/TypeScript, React, Node.js, and cloud technologies.',
    url: 'https://techcorp.com/careers/1',
    source: 'indeed',
    remote: false,
    posted: '2024-01-15',
    experience: 'Senior',
    type: 'Full-time',
    skills: ['JavaScript', 'React', 'Node.js', 'AWS', 'TypeScript']
  },
  {
    id: '2',
    title: 'Frontend Developer',
    company: 'Startup Inc',
    location: 'Remote',
    salary: '$120,000 - $160,000',
    description: 'Frontend developer with React experience needed for fast-growing startup.',
    fullDescription: 'Join our team as a Frontend Developer working on cutting-edge web applications. You will collaborate with designers and backend engineers to create amazing user experiences.',
    url: 'https://startupinc.com/jobs/2',
    source: 'remoteok',
    remote: true,
    posted: '2024-01-14',
    experience: 'Mid-level',
    type: 'Full-time',
    skills: ['React', 'JavaScript', 'CSS', 'HTML', 'Redux']
  },
  {
    id: '3',
    title: 'DevOps Engineer',
    company: 'Cloud Systems',
    location: 'New York, NY',
    salary: '$130,000 - $180,000',
    description: 'DevOps engineer with AWS and Kubernetes experience.',
    fullDescription: 'DevOps Engineer needed to manage our cloud infrastructure and CI/CD pipelines. Experience with Docker, Kubernetes, AWS, and Terraform required.',
    url: 'https://cloudsystems.com/careers/3',
    source: 'indeed',
    remote: false,
    posted: '2024-01-13',
    experience: 'Senior',
    type: 'Full-time',
    skills: ['AWS', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD']
  },
  {
    id: '4',
    title: 'Full Stack Developer',
    company: 'Digital Solutions',
    location: 'Austin, TX',
    salary: '$110,000 - $150,000',
    description: 'Full stack developer with Node.js and React experience.',
    fullDescription: 'Full Stack Developer position working on both frontend and backend systems. We use modern JavaScript technologies across the stack.',
    url: 'https://digitalsolutions.com/jobs/4',
    source: 'indeed',
    remote: false,
    posted: '2024-01-12',
    experience: 'Mid-level',
    type: 'Full-time',
    skills: ['Node.js', 'React', 'MongoDB', 'Express', 'JavaScript']
  },
  {
    id: '5',
    title: 'Data Scientist',
    company: 'AI Research',
    location: 'Remote',
    salary: '$140,000 - $190,000',
    description: 'Data scientist with machine learning experience.',
    fullDescription: 'Data Scientist position focusing on machine learning models and data analysis. Python, TensorFlow, and statistical analysis experience required.',
    url: 'https://airesearch.com/careers/5',
    source: 'remoteok',
    remote: true,
    posted: '2024-01-11',
    experience: 'Senior',
    type: 'Full-time',
    skills: ['Python', 'Machine Learning', 'TensorFlow', 'SQL', 'Statistics']
  },
  {
    id: '6',
    title: 'Mobile Developer',
    company: 'App Creators',
    location: 'Los Angeles, CA',
    salary: '$100,000 - $140,000',
    description: 'Mobile developer for iOS and Android applications.',
    fullDescription: 'Mobile Developer needed to build cross-platform mobile applications using React Native.',
    url: 'https://appcreators.com/jobs/6',
    source: 'indeed',
    remote: false,
    posted: '2024-01-10',
    experience: 'Mid-level',
    type: 'Full-time',
    skills: ['React Native', 'JavaScript', 'iOS', 'Android', 'Mobile']
  },
  {
    id: '7',
    title: 'Backend Engineer',
    company: 'API Masters',
    location: 'Remote',
    salary: '$130,000 - $170,000',
    description: 'Backend engineer with Python and Django experience.',
    fullDescription: 'Backend Engineer specializing in API development and microservices architecture.',
    url: 'https://apimasters.com/careers/7',
    source: 'remoteok',
    remote: true,
    posted: '2024-01-09',
    experience: 'Senior',
    type: 'Full-time',
    skills: ['Python', 'Django', 'PostgreSQL', 'REST API', 'Docker']
  },
  {
    id: '8',
    title: 'UI/UX Designer',
    company: 'Design Studio',
    location: 'Chicago, IL',
    salary: '$90,000 - $130,000',
    description: 'UI/UX designer with Figma and prototyping skills.',
    fullDescription: 'UI/UX Designer needed to create beautiful and functional user interfaces.',
    url: 'https://designstudio.com/jobs/8',
    source: 'indeed',
    remote: false,
    posted: '2024-01-08',
    experience: 'Mid-level',
    type: 'Full-time',
    skills: ['Figma', 'UI Design', 'UX Design', 'Prototyping', 'Adobe XD']
  },
  {
    id: '9',
    title: 'Product Manager',
    company: 'Tech Products Inc',
    location: 'Seattle, WA',
    salary: '$140,000 - $180,000',
    description: 'Product Manager for software products.',
    fullDescription: 'Product Manager responsible for product strategy and roadmap.',
    url: 'https://techproducts.com/careers/9',
    source: 'indeed',
    remote: false,
    posted: '2024-01-07',
    experience: 'Senior',
    type: 'Full-time',
    skills: ['Product Management', 'Agile', 'Strategy', 'Roadmapping']
  },
  {
    id: '10',
    title: 'QA Engineer',
    company: 'Quality First',
    location: 'Remote',
    salary: '$85,000 - $120,000',
    description: 'QA Engineer with automation testing experience.',
    fullDescription: 'Quality Assurance Engineer focused on automated testing and quality processes.',
    url: 'https://qualityfirst.com/jobs/10',
    source: 'remoteok',
    remote: true,
    posted: '2024-01-06',
    experience: 'Mid-level',
    type: 'Full-time',
    skills: ['Testing', 'Automation', 'Selenium', 'Cypress', 'QA']
  }
];

// More jobs for variety
for (let i = 11; i <= 50; i++) {
  const templates = [
    {
      title: `Software Engineer ${i}`,
      company: ['Tech Corp', 'Startup Inc', 'Cloud Systems', 'Digital Solutions'][Math.floor(Math.random() * 4)],
      location: ['San Francisco, CA', 'New York, NY', 'Remote', 'Austin, TX', 'Boston, MA'][Math.floor(Math.random() * 5)],
      salary: `$${Math.floor(Math.random() * 50) + 100},000 - $${Math.floor(Math.random() * 80) + 150,000}`,
      remote: Math.random() > 0.5,
      skills: [['JavaScript', 'React', 'Node.js'], ['Python', 'Django', 'PostgreSQL'], ['Java', 'Spring', 'Microservices']][Math.floor(Math.random() * 3)]
    },
    {
      title: `DevOps Specialist ${i}`,
      company: ['Cloud Systems', 'Tech Corp', 'Infra Tech'][Math.floor(Math.random() * 3)],
      location: ['Remote', 'New York, NY', 'Seattle, WA'][Math.floor(Math.random() * 3)],
      salary: `$${Math.floor(Math.random() * 40) + 120},000 - $${Math.floor(Math.random() * 70) + 160,000}`,
      remote: true,
      skills: ['AWS', 'Kubernetes', 'Docker', 'Terraform']
    }
  ];
  
  const template = templates[Math.floor(Math.random() * templates.length)];
  const isRemote = template.location === 'Remote' || template.remote;
  
  jobsDatabase.push({
    id: i.toString(),
    title: template.title,
    company: template.company,
    location: template.location,
    salary: template.salary,
    description: `${template.title} position at ${template.company}. Requires experience with ${template.skills.join(', ')}.`,
    fullDescription: `We are hiring a ${template.title} to join our team. This position requires expertise in ${template.skills.join(', ')}. Competitive salary and benefits package.`,
    url: `https://example.com/jobs/${i}`,
    source: isRemote ? 'remoteok' : 'indeed',
    remote: isRemote,
    posted: `2024-01-${Math.floor(Math.random() * 15) + 1}`,
    experience: ['Junior', 'Mid-level', 'Senior'][Math.floor(Math.random() * 3)],
    type: 'Full-time',
    skills: template.skills
  });
}

// Helper function to filter jobs
function filterJobs(keywords = '', location = '', remoteOnly = false) {
  const searchTerm = keywords.toLowerCase();
  const locationTerm = location.toLowerCase();
  
  return jobsDatabase.filter(job => {
    // Keyword search
    const matchesKeywords = !searchTerm || 
      job.title.toLowerCase().includes(searchTerm) ||
      job.company.toLowerCase().includes(searchTerm) ||
      job.description.toLowerCase().includes(searchTerm) ||
      job.skills.some(skill => skill.toLowerCase().includes(searchTerm));
    
    // Location search
    const matchesLocation = !locationTerm || 
      job.location.toLowerCase().includes(locationTerm) ||
      (locationTerm === 'remote' && job.remote);
    
    // Remote filter
    const matchesRemote = !remoteOnly || job.remote;
    
    return matchesKeywords && matchesLocation && matchesRemote;
  });
}

// ========================
// API ENDPOINTS
// ========================

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Jobs Scraper API',
    version: '1.0.0',
    description: 'API for job search and listings',
    endpoints: {
      health: '/api/health',
      search: '/api/search/:keywords',
      searchWithLocation: '/api/search/:keywords/:location',
      jobDetails: '/api/job/:id',
      trending: '/api/trending',
      trendingCategory: '/api/trending/:category',
      stats: '/api/stats',
      allJobs: '/api/jobs'
    },
    example: '/api/search/software%20engineer?remote=true'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    totalJobs: jobsDatabase.length
  });
});

// Get all jobs (for testing)
app.get('/api/jobs', (req, res) => {
  const { limit = 20, page = 1 } = req.query;
  const start = (page - 1) * limit;
  const end = start + parseInt(limit);
  
  const jobs = jobsDatabase.slice(start, end).map(job => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    remote: job.remote,
    source: job.source
  }));
  
  res.json({
    success: true,
    page: parseInt(page),
    limit: parseInt(limit),
    total: jobsDatabase.length,
    totalPages: Math.ceil(jobsDatabase.length / limit),
    jobs
  });
});

// Main search endpoint
app.get('/api/search/:keywords', (req, res) => {
  try {
    const { keywords } = req.params;
    const { location = '', remote = false } = req.query;
    
    if (!keywords) {
      return res.status(400).json({
        success: false,
        error: 'Search keywords are required'
      });
    }
    
    const remoteOnly = remote === 'true' || remote === true;
    const filteredJobs = filterJobs(keywords, location, remoteOnly);
    
    res.json({
      success: true,
      search: {
        keywords,
        location: location || 'anywhere',
        remote: remoteOnly
      },
      results: {
        total: filteredJobs.length,
        jobs: filteredJobs.slice(0, 30).map(job => ({
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          salary: job.salary,
          remote: job.remote,
          source: job.source,
          posted: job.posted,
          description: job.description.substring(0, 100) + '...',
          skills: job.skills.slice(0, 3)
        }))
      },
      metadata: {
        timestamp: new Date().toISOString(),
        processingTime: '0ms'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

// Search with location in path
app.get('/api/search/:keywords/:location', (req, res) => {
  const { keywords, location } = req.params;
  req.params.keywords = keywords;
  req.query.location = location;
  
  // Reuse the main search handler
  const mockReq = { 
    params: { keywords }, 
    query: { location, remote: req.query.remote } 
  };
  const mockRes = {
    status: (code) => ({
      json: (data) => res.status(code).json(data)
    }),
    json: (data) => res.json(data)
  };
  
  return app._router.handle({ 
    method: 'GET', 
    url: `/api/search/${keywords}`, 
    params: { keywords }, 
    query: { location, remote: req.query.remote } 
  }, res, () => {});
});

// Job details endpoint
app.get('/api/job/:id', (req, res) => {
  const { id } = req.params;
  const job = jobsDatabase.find(j => j.id === id);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  res.json({
    success: true,
    job: {
      ...job,
      applicationInstructions: 'Apply through the company website or the provided URL.',
      tips: [
        'Tailor your resume to match the job requirements',
        'Highlight relevant experience and skills',
        'Prepare for technical interviews if applicable'
      ],
      similarJobs: jobsDatabase
        .filter(j => 
          j.id !== id && 
          (j.skills.some(skill => job.skills.includes(skill)) || j.company === job.company)
        )
        .slice(0, 3)
        .map(j => ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: j.salary,
          remote: j.remote
        }))
    },
    metadata: {
      timestamp: new Date().toISOString()
    }
  });
});

// Trending jobs
app.get('/api/trending', (req, res) => {
  const { category = 'all', limit = 10 } = req.query;
  
  let trendingJobs = [...jobsDatabase];
  
  // Sort by newest first
  trendingJobs.sort((a, b) => new Date(b.posted) - new Date(a.posted));
  
  // Filter by category
  if (category !== 'all') {
    trendingJobs = trendingJobs.filter(job => {
      if (category === 'remote') return job.remote;
      if (category === 'software-engineer') return job.title.toLowerCase().includes('software') || job.title.toLowerCase().includes('engineer');
      if (category === 'web-developer') return job.title.toLowerCase().includes('web') || job.title.toLowerCase().includes('frontend') || job.title.toLowerCase().includes('full stack');
      if (category === 'data-scientist') return job.title.toLowerCase().includes('data');
      if (category === 'devops') return job.title.toLowerCase().includes('devops') || job.skills.includes('AWS') || job.skills.includes('Kubernetes');
      return true;
    });
  }
  
  const limitedJobs = trendingJobs.slice(0, parseInt(limit));
  
  res.json({
    success: true,
    category,
    results: {
      jobs: limitedJobs.map(job => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        remote: job.remote,
        posted: job.posted,
        skills: job.skills.slice(0, 3)
      })),
      count: limitedJobs.length,
      total: trendingJobs.length
    },
    popularCategories: [
      { id: 'software-engineer', name: 'Software Engineer', count: jobsDatabase.filter(j => j.title.toLowerCase().includes('software')).length },
      { id: 'web-developer', name: 'Web Developer', count: jobsDatabase.filter(j => j.title.toLowerCase().includes('web') || j.title.toLowerCase().includes('frontend')).length },
      { id: 'data-scientist', name: 'Data Scientist', count: jobsDatabase.filter(j => j.title.toLowerCase().includes('data')).length },
      { id: 'devops', name: 'DevOps', count: jobsDatabase.filter(j => j.title.toLowerCase().includes('devops')).length },
      { id: 'remote', name: 'Remote Jobs', count: jobsDatabase.filter(j => j.remote).length }
    ],
    metadata: {
      timestamp: new Date().toISOString()
    }
  });
});

// Trending by category
app.get('/api/trending/:category', (req, res) => {
  const { category } = req.params;
  const { limit = 10 } = req.query;
  
  req.query.category = category;
  req.query.limit = limit;
  
  // Call trending endpoint
  return app._router.handle(req, res, () => {});
});

// Statistics
app.get('/api/stats', (req, res) => {
  const remoteJobs = jobsDatabase.filter(j => j.remote).length;
  const averageSalary = jobsDatabase.reduce((sum, job) => {
    const mid = job.salary ? parseInt(job.salary.match(/\$(\d+),/)?.[1] || '120') * 1000 : 120000;
    return sum + mid;
  }, 0) / jobsDatabase.length;
  
  // Count jobs by location
  const locations = {};
  jobsDatabase.forEach(job => {
    locations[job.location] = (locations[job.location] || 0) + 1;
  });
  
  // Count jobs by skill
  const skills = {};
  jobsDatabase.forEach(job => {
    job.skills.forEach(skill => {
      skills[skill] = (skills[skill] || 0) + 1;
    });
  });
  
  res.json({
    success: true,
    stats: {
      totalJobs: jobsDatabase.length,
      remoteJobs,
      remotePercentage: Math.round((remoteJobs / jobsDatabase.length) * 100),
      averageSalary: `$${Math.round(averageSalary / 1000)}k`,
      topLocations: Object.entries(locations)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([location, count]) => ({ location, count })),
      topSkills: Object.entries(skills)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([skill, count]) => ({ skill, count })),
      jobsBySource: {
        indeed: jobsDatabase.filter(j => j.source === 'indeed').length,
        remoteok: jobsDatabase.filter(j => j.source === 'remoteok').length
      }
    },
    metadata: {
      timestamp: new Date().toISOString(),
      dataSource: 'Mock database',
      lastUpdated: '2024-01-15'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The route ${req.url} does not exist`,
    availableEndpoints: [
      'GET /',
      'GET /api/health',
      'GET /api/jobs',
      'GET /api/search/:keywords',
      'GET /api/search/:keywords/:location',
      'GET /api/job/:id',
      'GET /api/trending',
      'GET /api/trending/:category',
      'GET /api/stats'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'Something went wrong. Please try again later.'
  });
});

// Start server (local only)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`
    ✅ Jobs Scraper API running on port ${PORT}
    
    Health:     http://localhost:${PORT}/api/health
    All Jobs:   http://localhost:${PORT}/api/jobs
    Search:     http://localhost:${PORT}/api/search/software%20engineer
    Trending:   http://localhost:${PORT}/api/trending
    Stats:      http://localhost:${PORT}/api/stats
    
    Examples:
    - http://localhost:${PORT}/api/search/web%20developer?remote=true
    - http://localhost:${PORT}/api/search/data%20scientist/remote
    - http://localhost:${Port}/api/trending/remote?limit=5
    - http://localhost:${Port}/api/job/1
    `);
  });
}

// Export for Vercel
module.exports = app;
