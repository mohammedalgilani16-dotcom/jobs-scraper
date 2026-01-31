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
const winston = require('winston');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ========================
// CONFIGURATION
// ========================
const CONFIG = {
  // Cache configuration
  cache: new NodeCache({ stdTTL: 600, checkperiod: 120 }),
  
  // Request timeout
  requestTimeout: 10000,
  
  // Max jobs per response
  maxJobsPerResponse: 30,
  
  // Job sources configuration (NO Puppeteer required)
  sources: {
    indeed: {
      baseUrl: 'https://www.indeed.com/jobs',
      enabled: true,
      maxJobs: 20
    },
    remoteok: {
      baseUrl: 'https://remoteok.com/remote',
      enabled: true,
      maxJobs: 15
    },
    linkedin: {
      baseUrl: 'https://linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
      enabled: false, // LinkedIn API is tricky without browser
      maxJobs: 15
    },
    github: {
      baseUrl: 'https://jobs.github.com/positions.json',
      enabled: true,
      maxJobs: 15
    },
    reed: {
      baseUrl: 'https://www.reed.co.uk/api/1.0/search',
      enabled: false, // Requires API key
      maxJobs: 15
    }
  },
  
  // Trending jobs configuration
  trendingCategories: [
    { name: 'software-engineer', keywords: 'software engineer', title: 'Software Engineer' },
    { name: 'web-developer', keywords: 'web developer', title: 'Web Developer' },
    { name: 'data-scientist', keywords: 'data scientist', title: 'Data Scientist' },
    { name: 'devops', keywords: 'devops engineer', title: 'DevOps Engineer' },
    { name: 'frontend', keywords: 'frontend developer', title: 'Frontend Developer' },
    { name: 'backend', keywords: 'backend developer', title: 'Backend Developer' },
    { name: 'fullstack', keywords: 'full stack developer', title: 'Full Stack Developer' },
    { name: 'mobile', keywords: 'mobile developer', title: 'Mobile Developer' },
    { name: 'ui-ux', keywords: 'ui ux designer', title: 'UI/UX Designer' },
    { name: 'product-manager', keywords: 'product manager', title: 'Product Manager' },
    { name: 'marketing', keywords: 'digital marketing', title: 'Digital Marketing' },
    { name: 'sales', keywords: 'sales representative', title: 'Sales Representative' },
    { name: 'remote', keywords: 'remote', title: 'Remote Jobs' }
  ],
  
  // Popular locations
  popularLocations: [
    'Remote',
    'New York, NY',
    'San Francisco, CA',
    'Austin, TX',
    'Chicago, IL',
    'Boston, MA',
    'Seattle, WA',
    'Los Angeles, CA',
    'Denver, CO',
    'Atlanta, GA'
  ]
};

// ========================
// LOGGING CONFIGURATION
// ========================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

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

// Request logging middleware
app.use((req, res, next) => {
  const requestId = uuidv4().slice(0, 8);
  req.requestId = requestId;
  
  logger.info(`[${requestId}] ${req.method} ${req.url} - ${req.ip}`);
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info(`[${requestId}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  req.startTime = Date.now();
  next();
});

// ========================
// UTILITY FUNCTIONS
// ========================
const generateCacheKey = (keywords, location) => {
  return `search:${keywords.toLowerCase().replace(/\s+/g, '_')}:${location.toLowerCase().replace(/\s+/g, '_')}`;
};

const cleanText = (text) => {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
};

const extractSalary = (text) => {
  if (!text) return null;
  
  const salaryPatterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*-\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i,
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:to|-)\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i,
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*-\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:k|K|thousand)/i,
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:per|/)\s*(?:year|yr|hour|hr|month)/i
  ];
  
  for (const pattern of salaryPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return null;
};

const extractSkills = (description) => {
  if (!description) return [];
  
  const commonSkills = [
    'JavaScript', 'Python', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift',
    'React', 'Angular', 'Vue.js', 'Node.js', 'Express.js', 'Django', 'Flask', 'Spring',
    'AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible',
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'SQL',
    'Git', 'Jenkins', 'CI/CD', 'Agile', 'Scrum', 'Jira', 'Confluence',
    'REST API', 'GraphQL', 'Microservices', 'Machine Learning', 'AI', 'Data Science',
    'HTML', 'CSS', 'SASS', 'TypeScript', 'Webpack', 'Babel', 'Redux', 'Next.js'
  ];
  
  const foundSkills = [];
  const descLower = description.toLowerCase();
  
  commonSkills.forEach(skill => {
    if (descLower.includes(skill.toLowerCase())) {
      foundSkills.push(skill);
    }
  });
  
  return foundSkills.slice(0, 10);
};

const normalizeJobData = (job, source) => {
  const isRemote = source === 'remoteok' || source === 'github' || 
                  (job.location && job.location.toLowerCase().includes('remote'));
  
  const normalizedJob = {
    id: uuidv4(),
    title: cleanText(job.title) || 'Not specified',
    company: cleanText(job.company) || 'Not specified',
    location: cleanText(job.location) || (isRemote ? 'Remote' : 'Not specified'),
    salary: extractSalary(job.salary || job.description || ''),
    description: cleanText(job.description) || '',
    url: job.url || job.apply_url || '',
    source: source,
    postedDate: job.postedDate || job.created_at || new Date().toISOString().split('T')[0],
    remote: isRemote,
    jobType: job.type || job.jobType || 'Full-time',
    experience: job.experience || 'Not specified'
  };
  
  // Extract skills from description
  normalizedJob.skills = extractSkills(normalizedJob.description);
  
  return normalizedJob;
};

// ========================
// DATA STORAGE (In-memory for demo)
// ========================
const jobsStore = new Map();

// ========================
// SCRAPER FUNCTIONS (NO PUPPETEER)
// ========================
class JobScraper {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async scrapeIndeed(keywords, location) {
    try {
      const url = new URL(CONFIG.sources.indeed.baseUrl);
      url.searchParams.append('q', keywords || 'developer');
      url.searchParams.append('l', location || '');
      
      logger.info(`Scraping Indeed: ${keywords} in ${location}`);
      
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'no-cache'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      // Indeed job listing selectors - updated for 2024
      const jobSelectors = [
        '.job_seen_beacon',
        '.result',
        '[data-tn-component="organicJob"]',
        '.cardOutline'
      ];
      
      let jobElements = $();
      jobSelectors.forEach(selector => {
        const elements = $(selector);
        if (elements.length > 0) {
          jobElements = jobElements.add(elements);
        }
      });
      
      // Fallback: try to find any job-like elements
      if (jobElements.length === 0) {
        jobElements = $('div[class*="job"], div[class*="Job"]');
      }
      
      jobElements.each((i, element) => {
        try {
          const title = $(element).find('.jobTitle').text() || 
                       $(element).find('.jobtitle').text() ||
                       $(element).find('h2.jobTitle').text() ||
                       $(element).find('h2[class*="title"]').text() ||
                       $(element).find('h2').first().text();
          
          const company = $(element).find('.companyName').text() || 
                         $(element).find('.company').text() ||
                         $(element).find('.companyName a').text() ||
                         $(element).find('[class*="company"]').text();
          
          const locationText = $(element).find('.companyLocation').text() || 
                              $(element).find('.location').text() ||
                              $(element).find('[class*="location"]').text();
          
          const salary = $(element).find('.salary-snippet').text() || 
                        $(element).find('.salaryText').text() ||
                        $(element).find('[class*="salary"]').text();
          
          const description = $(element).find('.job-snippet').text() || 
                            $(element).find('.summary').text() ||
                            $(element).find('[class*="snippet"]').text() ||
                            $(element).find('[class*="description"]').text();
          
          let url = $(element).find('.jcs-JobTitle').attr('href') ||
                   $(element).find('a.jobtitle').attr('href') ||
                   $(element).find('a[class*="job"]').attr('href') ||
                   $(element).find('a').first().attr('href');
          
          if (url && !url.startsWith('http')) {
            url = `https://indeed.com${url}`;
          }
          
          if (title && company) {
            const job = {
              title: title.trim(),
              company: company.trim(),
              location: locationText ? locationText.trim() : location || 'Not specified',
              salary: salary ? salary.trim() : '',
              description: description ? description.trim() : '',
              url: url || ''
            };
            
            const normalizedJob = normalizeJobData(job, 'indeed');
            if (normalizedJob.title.toLowerCase() !== 'not specified') {
              jobsStore.set(normalizedJob.id, normalizedJob);
              jobs.push(normalizedJob);
            }
          }
        } catch (err) {
          // Skip this job if there's an error
        }
      });
      
      logger.info(`Indeed returned ${jobs.length} jobs`);
      return jobs.slice(0, CONFIG.sources.indeed.maxJobs);
    } catch (error) {
      logger.error('Indeed scraping error:', error.message);
      return [];
    }
  }

  async scrapeRemoteOK(keywords) {
    try {
      const url = `${CONFIG.sources.remoteok.baseUrl}-${keywords || 'developer'}-jobs`;
      
      logger.info(`Scraping RemoteOK: ${keywords}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      $('tr.job').each((i, element) => {
        try {
          const title = $(element).find('.company_and_position h2').text();
          const company = $(element).find('.companyLink h3').text();
          const description = $(element).find('.description').text();
          const urlElement = $(element).attr('data-url');
          
          if (title && company) {
            const job = {
              title: title.trim(),
              company: company.trim(),
              location: 'Remote',
              description: description ? description.trim() : '',
              url: urlElement ? `https://remoteok.com${urlElement}` : ''
            };
            
            const normalizedJob = normalizeJobData(job, 'remoteok');
            jobsStore.set(normalizedJob.id, normalizedJob);
            jobs.push(normalizedJob);
          }
        } catch (err) {
          // Skip this job if there's an error
        }
      });
      
      logger.info(`RemoteOK returned ${jobs.length} jobs`);
      return jobs.slice(0, CONFIG.sources.remoteok.maxJobs);
    } catch (error) {
      logger.error('RemoteOK scraping error:', error.message);
      return [];
    }
  }

  async scrapeGitHub(keywords, location) {
    try {
      const url = new URL(CONFIG.sources.github.baseUrl);
      url.searchParams.append('description', keywords || 'developer');
      if (location && location.toLowerCase() !== 'remote') {
        url.searchParams.append('location', location);
      }
      
      logger.info(`Scraping GitHub Jobs: ${keywords} in ${location}`);
      
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const jobs = [];
      const jobsData = response.data || [];
      
      jobsData.forEach(jobData => {
        try {
          const job = {
            title: jobData.title || '',
            company: jobData.company || '',
            location: jobData.location || 'Remote',
            description: jobData.description || '',
            url: jobData.url || '',
            type: jobData.type || 'Full-time',
            created_at: jobData.created_at
          };
          
          const normalizedJob = normalizeJobData(job, 'github');
          jobsStore.set(normalizedJob.id, normalizedJob);
          jobs.push(normalizedJob);
        } catch (err) {
          // Skip this job if there's an error
        }
      });
      
      logger.info(`GitHub Jobs returned ${jobs.length} jobs`);
      return jobs.slice(0, CONFIG.sources.github.maxJobs);
    } catch (error) {
      logger.error('GitHub Jobs scraping error:', error.message);
      return [];
    }
  }

  async searchJobs(keywords = 'developer', location = '') {
    try {
      const cacheKey = generateCacheKey(keywords, location);
      const cachedData = CONFIG.cache.get(cacheKey);
      
      if (cachedData) {
        logger.info(`Cache hit for: ${keywords} in ${location}`);
        return {
          ...cachedData,
          cached: true
        };
      }
      
      logger.info(`Starting job search: ${keywords} in ${location}`);
      
      // Scrape from all enabled sources with timeout
      const scrapePromises = [];
      
      if (CONFIG.sources.indeed.enabled) {
        scrapePromises.push(
          Promise.race([
            this.scrapeIndeed(keywords, location),
            new Promise(resolve => setTimeout(() => resolve([]), 8000))
          ])
        );
      }
      
      if (CONFIG.sources.remoteok.enabled) {
        scrapePromises.push(
          Promise.race([
            this.scrapeRemoteOK(keywords),
            new Promise(resolve => setTimeout(() => resolve([]), 8000))
          ])
        );
      }
      
      if (CONFIG.sources.github.enabled) {
        scrapePromises.push(
          Promise.race([
            this.scrapeGitHub(keywords, location),
            new Promise(resolve => setTimeout(() => resolve([]), 8000))
          ])
        );
      }
      
      const results = await Promise.allSettled(scrapePromises);
      
      // Combine all jobs
      let allJobs = [];
      let sourcesUsed = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allJobs = allJobs.concat(result.value);
          const sourceNames = ['indeed', 'remoteok', 'github'];
          if (index < sourceNames.length) {
            sourcesUsed.push(sourceNames[index]);
          }
        }
      });
      
      // Remove duplicates
      const uniqueJobs = [];
      const seen = new Set();
      
      allJobs.forEach(job => {
        const key = `${job.title.toLowerCase()}-${job.company.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueJobs.push(job);
        }
      });
      
      // Take top N jobs
      const topJobs = uniqueJobs.slice(0, CONFIG.maxJobsPerResponse);
      
      const result = {
        success: true,
        jobs: topJobs,
        count: topJobs.length,
        keywords,
        location,
        sources: sourcesUsed,
        timestamp: new Date().toISOString(),
        cached: false
      };
      
      // Cache the result
      CONFIG.cache.set(cacheKey, result);
      
      return result;
    } catch (error) {
      logger.error('Search jobs error:', error.message);
      return {
        success: false,
        jobs: [],
        count: 0,
        keywords,
        location,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Initialize scraper
const scraper = new JobScraper();

// ========================
// API ROUTES
// ========================

// Health check endpoint
app.get('/api/health', (req, res) => {
  const cacheStats = CONFIG.cache.getStats();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    cache: {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      keys: cacheStats.keys
    },
    config: {
      maxJobs: CONFIG.maxJobsPerResponse,
      sources: Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled),
      totalJobsStored: jobsStore.size
    }
  });
});

// Main search endpoint
app.get('/api/search/:keywords/:location?', 
  [
    query('remote').optional().isBoolean().toBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid parameters',
          details: errors.array() 
        });
      }
      
      const { keywords, location = '' } = req.params;
      const { remote } = req.query;
      
      if (!keywords || keywords.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Keywords are required',
          message: 'Please provide job search keywords'
        });
      }
      
      logger.info(`Search request: ${keywords} in ${location || 'anywhere'}${remote ? ' (remote only)' : ''}`);
      
      // Search for jobs
      const searchResult = await scraper.searchJobs(keywords, location);
      
      if (!searchResult.success) {
        return res.status(500).json(searchResult);
      }
      
      // Filter remote jobs if requested
      let filteredJobs = searchResult.jobs;
      if (remote === true) {
        filteredJobs = searchResult.jobs.filter(job => job.remote === true);
      }
      
      // Calculate statistics
      const stats = {
        totalJobs: filteredJobs.length,
        remoteJobs: filteredJobs.filter(job => job.remote).length,
        sources: searchResult.sources || [],
        hasSalary: filteredJobs.filter(job => job.salary).length,
        averageSkills: filteredJobs.length > 0 
          ? Math.round(filteredJobs.reduce((sum, job) => sum + job.skills.length, 0) / filteredJobs.length)
          : 0
      };
      
      const response = {
        success: true,
        search: {
          keywords,
          location: location || 'anywhere',
          remoteFilter: remote || false
        },
        results: {
          jobs: filteredJobs.map(job => ({
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            salary: job.salary,
            remote: job.remote,
            postedDate: job.postedDate,
            source: job.source,
            skills: job.skills.slice(0, 3)
          })),
          count: filteredJobs.length,
          stats
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
          cached: searchResult.cached || false
        }
      };
      
      res.json(response);
      
    } catch (error) {
      logger.error('Search endpoint error:', {
        error: error.message,
        requestId: req.requestId
      });
      
      res.status(500).json({
        success: false,
        error: 'Search failed',
        message: error.message,
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    }
});

// Get job details by ID
app.get('/api/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }
    
    logger.info(`Job details request: ${jobId}`);
    
    // Get job from store
    const job = jobsStore.get(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
        message: 'The requested job ID does not exist or has expired. Try searching for jobs first.',
        timestamp: new Date().toISOString()
      });
    }
    
    const response = {
      success: true,
      job: {
        ...job,
        description: job.description || 'No description available',
        fullDetails: {
          source: job.source,
          scrapedAt: new Date().toISOString(),
          url: job.url,
          applicationMethod: job.url ? 'Apply via link' : 'Contact company directly'
        }
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        cacheInfo: 'Job details are cached for 10 minutes'
      }
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Job details error:', {
      error: error.message,
      jobId: req.params.jobId,
      requestId: req.requestId
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get job details',
      message: error.message,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Get trending jobs by category
app.get('/api/trending/:category?', async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10 } = req.query;
    
    const cacheKey = `trending:${category || 'all'}:${limit}`;
    const cachedData = CONFIG.cache.get(cacheKey);
    
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true
      });
    }
    
    logger.info(`Trending jobs request: ${category || 'all categories'}`);
    
    let trendingJobs = [];
    
    if (category) {
      // Find specific category
      const foundCategory = CONFIG.trendingCategories.find(cat => cat.name === category);
      if (foundCategory) {
        const searchResult = await scraper.searchJobs(foundCategory.keywords, '');
        if (searchResult.success) {
          trendingJobs = searchResult.jobs.slice(0, limit).map(job => ({
            ...job,
            category: foundCategory.title
          }));
        }
      }
    } else {
      // Get jobs for top 3 trending categories
      const topCategories = CONFIG.trendingCategories.slice(0, 3);
      const fetchPromises = topCategories.map(cat => 
        scraper.searchJobs(cat.keywords, '').then(result => 
          result.success ? result.jobs.slice(0, Math.ceil(limit / 3)) : []
        )
      );
      
      const results = await Promise.all(fetchPromises);
      results.forEach((categoryJobs, index) => {
        trendingJobs.push(...categoryJobs.map(job => ({
          ...job,
          category: topCategories[index].title
        })));
      });
    }
    
    // Remove duplicates
    const uniqueJobs = [];
    const seen = new Set();
    
    trendingJobs.forEach(job => {
      const key = `${job.title}-${job.company}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueJobs.push(job);
      }
    });
    
    const response = {
      success: true,
      category: category || 'all',
      results: {
        jobs: uniqueJobs.slice(0, limit),
        count: uniqueJobs.length,
        categories: category ? [CONFIG.trendingCategories.find(c => c.name === category)] : CONFIG.trendingCategories.slice(0, 3)
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        cached: false
      }
    };
    
    // Cache for 5 minutes
    CONFIG.cache.set(cacheKey, response, 300);
    
    res.json(response);
    
  } catch (error) {
    logger.error('Trending jobs error:', {
      error: error.message,
      category: req.params.category,
      requestId: req.requestId
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get trending jobs',
      message: error.message,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Get popular locations
app.get('/api/locations/popular', async (req, res) => {
  try {
    const cacheKey = 'popular-locations';
    const cachedData = CONFIG.cache.get(cacheKey);
    
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true
      });
    }
    
    const locations = CONFIG.popularLocations.map(location => ({
      name: location,
      jobCount: Math.floor(Math.random() * 1000) + 100,
      trending: Math.random() > 0.5
    }));
    
    const response = {
      success: true,
      locations,
      count: locations.length,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      }
    };
    
    CONFIG.cache.set(cacheKey, response, 1800);
    
    res.json(response);
  } catch (error) {
    logger.error('Popular locations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular locations',
      message: error.message
    });
  }
});

// Quick search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const searchResult = await scraper.searchJobs('developer', '');
    
    const response = {
      success: true,
      message: 'Showing latest developer jobs. Use /api/search/{keywords}/{location} for custom search.',
      results: {
        jobs: searchResult.jobs.slice(0, 20).map(job => ({
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          salary: job.salary,
          remote: job.remote,
          source: job.source
        })),
        count: Math.min(searchResult.jobs.length, 20)
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        cached: searchResult.cached || false
      }
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Quick search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

// Get job statistics
app.get('/api/stats', async (req, res) => {
  try {
    const cacheKey = 'global-stats';
    const cachedStats = CONFIG.cache.get(cacheKey);
    
    if (cachedStats) {
      return res.json({
        ...cachedStats,
        cached: true
      });
    }
    
    const stats = {
      totalJobsIndexed: jobsStore.size,
      activeSources: Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled),
      popularKeywords: CONFIG.trendingCategories.slice(0, 5).map(cat => cat.keywords),
      cachePerformance: CONFIG.cache.getStats(),
      lastUpdated: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
    
    const response = {
      success: true,
      stats,
      cached: false,
      timestamp: new Date().toISOString()
    };
    
    CONFIG.cache.set(cacheKey, response, 300);
    
    res.json(response);
  } catch (error) {
    logger.error('Stats endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

// Clear cache endpoint
app.post('/api/admin/cache/clear', (req, res) => {
  try {
    const { auth } = req.body;
    
    if (!process.env.ADMIN_SECRET || auth !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        message: 'Invalid admin secret'
      });
    }
    
    const stats = CONFIG.cache.getStats();
    CONFIG.cache.flushAll();
    jobsStore.clear();
    
    logger.info('Cache and job store cleared', { 
      requestId: req.requestId,
      previousStats: stats 
    });
    
    res.json({
      success: true,
      message: 'Cache and job store cleared successfully',
      previousStats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Cache clear error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    });
  }
});

// ========================
// ERROR HANDLING
// ========================
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.url} does not exist`,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'GET /api/health',
      'GET /api/search/:keywords/:location?',
      'GET /api/search',
      'GET /api/job/:jobId',
      'GET /api/trending/:category?',
      'GET /api/locations/popular',
      'GET /api/stats',
      'POST /api/admin/cache/clear'
    ]
  });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    requestId: req.requestId
  });
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'Something went wrong',
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

// ========================
// SERVER START
// ========================
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Jobs Scraper API server running on port ${PORT}`);
    console.log(`
    💼 Jobs Scraper API Server Started!
    ===================================
    Port: ${PORT}
    Environment: ${process.env.NODE_ENV || 'development'}
    Health Check: http://localhost:${PORT}/api/health
    Search: http://localhost:${PORT}/api/search/{keywords}/{location}
    Job Details: http://localhost:${PORT}/api/job/{jobId}
    Trending Jobs: http://localhost:${PORT}/api/trending/{category?}
    Max Jobs: ${CONFIG.maxJobsPerResponse}
    Sources: ${Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled).join(', ')}
    `);
  });
}

// Export for Vercel
module.exports = app;
