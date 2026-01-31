require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { query, validationResult } = require('express-validator');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ========================
// CONFIGURATION
// ========================
const CONFIG = {
  cache: new NodeCache({ stdTTL: 300, checkperiod: 60 }),
  requestTimeout: 8000,
  maxJobsPerResponse: 25,
  
  sources: {
    indeed: {
      baseUrl: 'https://www.indeed.com/jobs',
      enabled: true,
      maxJobs: 15
    },
    remoteok: {
      baseUrl: 'https://remoteok.com/remote',
      enabled: true,
      maxJobs: 10
    },
    github: {
      baseUrl: 'https://jobs.github.com/positions.json',
      enabled: true,
      maxJobs: 10
    }
  },
  
  trendingCategories: [
    { name: 'software-engineer', keywords: 'software engineer', title: 'Software Engineer' },
    { name: 'web-developer', keywords: 'web developer', title: 'Web Developer' },
    { name: 'data-scientist', keywords: 'data scientist', title: 'Data Scientist' },
    { name: 'devops', keywords: 'devops engineer', title: 'DevOps Engineer' },
    { name: 'remote', keywords: 'remote', title: 'Remote Jobs' }
  ]
};

// ========================
// MIDDLEWARE
// ========================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  req.requestId = uuidv4().slice(0, 8);
  req.startTime = Date.now();
  next();
});

// ========================
// UTILITY FUNCTIONS
// ========================
const generateCacheKey = (keywords, location) => {
  return `search:${keywords.toLowerCase()}:${location.toLowerCase()}`;
};

const cleanText = (text) => {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
};

const normalizeJobData = (job, source) => {
  const id = uuidv4();
  const isRemote = source === 'remoteok' || source === 'github' || 
                  (job.location && job.location.toLowerCase().includes('remote'));
  
  const normalizedJob = {
    id,
    title: cleanText(job.title) || 'Job Title',
    company: cleanText(job.company) || 'Company',
    location: cleanText(job.location) || (isRemote ? 'Remote' : 'Location not specified'),
    salary: job.salary || '',
    description: cleanText(job.description) || '',
    url: job.url || '',
    source,
    postedDate: job.postedDate || new Date().toISOString().split('T')[0],
    remote: isRemote
  };
  
  // Store in memory
  jobsStore.set(id, normalizedJob);
  
  return normalizedJob;
};

// ========================
// DATA STORAGE
// ========================
const jobsStore = new Map();

// ========================
// SCRAPER FUNCTIONS
// ========================
class JobScraper {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    ];
  }

  async scrapeIndeed(keywords, location) {
    try {
      const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}`;
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.userAgents[0] },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      // Simple Indeed scraping
      $('.job_seen_beacon, .result, .cardOutline').each((i, element) => {
        const title = $(element).find('.jobTitle, .jobtitle, h2').first().text();
        const company = $(element).find('.companyName, .company').first().text();
        const locationText = $(element).find('.companyLocation, .location').first().text();
        
        if (title && company) {
          const job = {
            title: title.trim(),
            company: company.trim(),
            location: locationText ? locationText.trim() : location || 'Not specified',
            description: $(element).find('.job-snippet, .summary').text() || '',
            url: $(element).find('a').attr('href') || ''
          };
          
          if (job.url && !job.url.startsWith('http')) {
            job.url = `https://indeed.com${job.url}`;
          }
          
          jobs.push(normalizeJobData(job, 'indeed'));
        }
      });
      
      return jobs.slice(0, CONFIG.sources.indeed.maxJobs);
    } catch (error) {
      console.error('Indeed scraping error:', error.message);
      return [];
    }
  }

  async scrapeRemoteOK(keywords) {
    try {
      const url = `https://remoteok.com/remote-${keywords || 'developer'}-jobs`;
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.userAgents[0] },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      $('tr.job').each((i, element) => {
        const title = $(element).find('.company_and_position h2').text();
        const company = $(element).find('.companyLink h3').text();
        
        if (title && company) {
          const job = {
            title: title.trim(),
            company: company.trim(),
            location: 'Remote',
            description: $(element).find('.description').text() || '',
            url: $(element).attr('data-url') || ''
          };
          
          if (job.url) {
            job.url = `https://remoteok.com${job.url}`;
          }
          
          jobs.push(normalizeJobData(job, 'remoteok'));
        }
      });
      
      return jobs.slice(0, CONFIG.sources.remoteok.maxJobs);
    } catch (error) {
      console.error('RemoteOK scraping error:', error.message);
      return [];
    }
  }

  async scrapeGitHub(keywords, location) {
    try {
      let url = `https://jobs.github.com/positions.json?description=${encodeURIComponent(keywords)}`;
      if (location && location.toLowerCase() !== 'remote') {
        url += `&location=${encodeURIComponent(location)}`;
      }
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.userAgents[0] },
        timeout: CONFIG.requestTimeout
      });
      
      const jobs = response.data.map(jobData => ({
        title: jobData.title || '',
        company: jobData.company || '',
        location: jobData.location || 'Remote',
        description: jobData.description || '',
        url: jobData.url || '',
        type: jobData.type || 'Full-time'
      }));
      
      return jobs.slice(0, CONFIG.sources.github.maxJobs).map(job => normalizeJobData(job, 'github'));
    } catch (error) {
      console.error('GitHub Jobs scraping error:', error.message);
      return [];
    }
  }

  async searchJobs(keywords = 'developer', location = '') {
    const cacheKey = generateCacheKey(keywords, location);
    const cachedData = CONFIG.cache.get(cacheKey);
    
    if (cachedData) {
      return { ...cachedData, cached: true };
    }
    
    const scrapePromises = [];
    
    if (CONFIG.sources.indeed.enabled) {
      scrapePromises.push(this.scrapeIndeed(keywords, location));
    }
    
    if (CONFIG.sources.remoteok.enabled) {
      scrapePromises.push(this.scrapeRemoteOK(keywords));
    }
    
    if (CONFIG.sources.github.enabled) {
      scrapePromises.push(this.scrapeGitHub(keywords, location));
    }
    
    const results = await Promise.allSettled(scrapePromises);
    
    let allJobs = [];
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allJobs = allJobs.concat(result.value);
      }
    });
    
    // Remove duplicates
    const uniqueJobs = [];
    const seen = new Set();
    
    allJobs.forEach(job => {
      const key = `${job.title}-${job.company}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueJobs.push(job);
      }
    });
    
    const result = {
      success: true,
      jobs: uniqueJobs.slice(0, CONFIG.maxJobsPerResponse),
      count: uniqueJobs.length,
      keywords,
      location,
      timestamp: new Date().toISOString()
    };
    
    CONFIG.cache.set(cacheKey, result);
    return result;
  }
}

const scraper = new JobScraper();

// ========================
// API ROUTES
// ========================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '2.0.0',
    cacheStats: CONFIG.cache.getStats(),
    totalJobs: jobsStore.size
  });
});

app.get('/api/search/:keywords/:location?', 
  [query('remote').optional().isBoolean().toBoolean()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: 'Invalid parameters' });
      }
      
      const { keywords, location = '' } = req.params;
      const { remote } = req.query;
      
      if (!keywords) {
        return res.status(400).json({ success: false, error: 'Keywords required' });
      }
      
      const searchResult = await scraper.searchJobs(keywords, location);
      
      let filteredJobs = searchResult.jobs;
      if (remote === true) {
        filteredJobs = filteredJobs.filter(job => job.remote === true);
      }
      
      const response = {
        success: true,
        search: { keywords, location, remote: remote || false },
        results: {
          jobs: filteredJobs.map(job => ({
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            salary: job.salary,
            remote: job.remote,
            source: job.source
          })),
          count: filteredJobs.length
        },
        metadata: {
          timestamp: new Date().toISOString(),
          cached: searchResult.cached || false
        }
      };
      
      res.json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Search failed',
        message: error.message
      });
    }
});

app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobsStore.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  res.json({
    success: true,
    job,
    metadata: {
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/trending/:category?', async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10 } = req.query;
    
    const cacheKey = `trending:${category || 'all'}:${limit}`;
    const cachedData = CONFIG.cache.get(cacheKey);
    
    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }
    
    let trendingJobs = [];
    
    if (category) {
      const foundCategory = CONFIG.trendingCategories.find(c => c.name === category);
      if (foundCategory) {
        const searchResult = await scraper.searchJobs(foundCategory.keywords, '');
        trendingJobs = searchResult.jobs.slice(0, limit);
      }
    } else {
      const searchResult = await scraper.searchJobs('developer', '');
      trendingJobs = searchResult.jobs.slice(0, limit);
    }
    
    const response = {
      success: true,
      category: category || 'all',
      jobs: trendingJobs,
      count: trendingJobs.length,
      timestamp: new Date().toISOString()
    };
    
    CONFIG.cache.set(cacheKey, response, 300);
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get trending jobs'
    });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const searchResult = await scraper.searchJobs('developer', '');
    
    res.json({
      success: true,
      message: 'Latest developer jobs',
      jobs: searchResult.jobs.slice(0, 15),
      count: searchResult.jobs.length,
      cached: searchResult.cached || false
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: {
      totalJobs: jobsStore.size,
      cacheHits: CONFIG.cache.getStats().hits,
      cacheMisses: CONFIG.cache.getStats().misses,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    },
    timestamp: new Date().toISOString()
  });
});

// ========================
// ERROR HANDLING
// ========================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    available: [
      '/api/health',
      '/api/search/:keywords/:location?',
      '/api/search',
      '/api/job/:jobId',
      '/api/trending/:category?',
      '/api/stats'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ========================
// START SERVER
// ========================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
    🚀 Jobs Scraper API Running!
    Port: ${PORT}
    Health: http://localhost:${PORT}/api/health
    Search: http://localhost:${PORT}/api/search/developer
    `);
  });
}

module.exports = app;
