require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { query, validationResult } = require('express-validator');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
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
  requestTimeout: 25000,
  
  // Max jobs per response
  maxJobsPerResponse: 50,
  
  // Job sources configuration
  sources: {
    indeed: {
      baseUrl: 'https://www.indeed.com/jobs',
      enabled: true,
      requiresBrowser: false
    },
    remoteok: {
      baseUrl: 'https://remoteok.com/remote',
      enabled: true,
      requiresBrowser: false
    },
    linkedin: {
      baseUrl: 'https://www.linkedin.com/jobs/search',
      enabled: true,
      requiresBrowser: true
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
  
  return foundSkills.slice(0, 10); // Limit to 10 skills
};

const normalizeJobData = (job, source) => {
  const isRemote = source === 'remoteok' || 
                  (job.location && job.location.toLowerCase().includes('remote'));
  
  const normalizedJob = {
    id: uuidv4(),
    title: cleanText(job.title) || 'Not specified',
    company: cleanText(job.company) || 'Not specified',
    location: cleanText(job.location) || (isRemote ? 'Remote' : 'Not specified'),
    salary: extractSalary(job.salary || job.description || ''),
    description: cleanText(job.description) || '',
    url: job.url || '',
    source: source,
    postedDate: job.postedDate || new Date().toISOString().split('T')[0],
    remote: isRemote,
    jobType: job.jobType || 'Full-time',
    experience: job.experience || 'Not specified'
  };
  
  // Extract skills from description
  normalizedJob.skills = extractSkills(normalizedJob.description);
  
  return normalizedJob;
};

// ========================
// DATA STORAGE (In-memory for demo)
// ========================
const jobsStore = new Map(); // Store jobs by ID for details endpoint

// ========================
// SCRAPER FUNCTIONS
// ========================
class JobScraper {
  constructor() {
    this.browser = null;
  }

  async getBrowser() {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ],
          timeout: CONFIG.requestTimeout
        });
      } catch (error) {
        logger.error('Failed to launch browser:', error.message);
        return null;
      }
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.error('Error closing browser:', error.message);
      }
      this.browser = null;
    }
  }

  async scrapeIndeed(keywords, location) {
    try {
      const url = new URL(CONFIG.sources.indeed.baseUrl);
      url.searchParams.append('q', keywords || 'developer');
      url.searchParams.append('l', location || '');
      
      logger.info(`Scraping Indeed: ${keywords} in ${location}`);
      
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      // Indeed job listing selectors
      const jobSelectors = [
        '.job_seen_beacon',
        '.result',
        '[data-tn-component="organicJob"]'
      ];
      
      let jobElements = $();
      jobSelectors.forEach(selector => {
        jobElements = jobElements.add($(selector));
      });
      
      jobElements.each((i, element) => {
        try {
          const title = $(element).find('.jobTitle').text() || 
                       $(element).find('.jobtitle').text() ||
                       $(element).find('h2.jobTitle').text();
          
          const company = $(element).find('.companyName').text() || 
                         $(element).find('.company').text() ||
                         $(element).find('.companyName a').text();
          
          const locationText = $(element).find('.companyLocation').text() || 
                              $(element).find('.location').text();
          
          const salary = $(element).find('.salary-snippet').text() || 
                        $(element).find('.salaryText').text();
          
          const description = $(element).find('.job-snippet').text() || 
                            $(element).find('.summary').text();
          
          let url = $(element).find('.jcs-JobTitle').attr('href') ||
                   $(element).find('a.jobtitle').attr('href') ||
                   $(element).find('a').attr('href');
          
          if (url && !url.startsWith('http')) {
            url = `https://indeed.com${url}`;
          }
          
          if (title && company) {
            const job = {
              title,
              company,
              location: locationText,
              salary,
              description,
              url: url || ''
            };
            const normalizedJob = normalizeJobData(job, 'indeed');
            jobsStore.set(normalizedJob.id, normalizedJob);
            jobs.push(normalizedJob);
          }
        } catch (err) {
          // Skip this job if there's an error
        }
      });
      
      logger.info(`Indeed returned ${jobs.length} jobs`);
      return jobs.slice(0, 20);
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
              title,
              company,
              location: 'Remote',
              description,
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
      return jobs.slice(0, 15);
    } catch (error) {
      logger.error('RemoteOK scraping error:', error.message);
      return [];
    }
  }

  async scrapeLinkedIn(keywords, location) {
    try {
      const browser = await this.getBrowser();
      if (!browser) {
        logger.warn('Browser not available for LinkedIn scraping');
        return [];
      }
      
      const page = await browser.newPage();
      
      // Set realistic headers
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 720 });
      
      // Build LinkedIn search URL
      const encodedKeywords = encodeURIComponent(keywords || 'developer');
      const encodedLocation = encodeURIComponent(location || '');
      const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodedKeywords}&location=${encodedLocation}`;
      
      logger.info(`Scraping LinkedIn: ${keywords} in ${location}`);
      
      // Navigate with timeout
      await page.goto(linkedinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      
      // Wait for job cards
      await page.waitForSelector('.base-card', { timeout: 10000 }).catch(() => {
        logger.warn('LinkedIn job cards not found, proceeding anyway');
      });
      
      // Extract job data
      const jobs = await page.evaluate(() => {
        const jobElements = document.querySelectorAll('.base-card');
        const jobList = [];
        
        jobElements.forEach(element => {
          try {
            const titleElement = element.querySelector('.base-search-card__title');
            const companyElement = element.querySelector('.base-search-card__subtitle');
            const locationElement = element.querySelector('.job-search-card__location');
            const urlElement = element.querySelector('.base-card__full-link');
            
            if (titleElement && companyElement) {
              jobList.push({
                title: titleElement.textContent?.trim() || '',
                company: companyElement.textContent?.trim() || '',
                location: locationElement?.textContent?.trim() || '',
                url: urlElement?.href || '',
                description: ''
              });
            }
          } catch (err) {
            // Skip this element if there's an error
          }
        });
        
        return jobList;
      });
      
      await page.close();
      
      logger.info(`LinkedIn returned ${jobs.length} jobs`);
      const normalizedJobs = jobs.slice(0, 15).map(job => {
        const normalizedJob = normalizeJobData(job, 'linkedin');
        jobsStore.set(normalizedJob.id, normalizedJob);
        return normalizedJob;
      });
      return normalizedJobs;
    } catch (error) {
      logger.error('LinkedIn scraping error:', error.message);
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
      
      if (CONFIG.sources.linkedin.enabled) {
        scrapePromises.push(
          Promise.race([
            this.scrapeLinkedIn(keywords, location),
            new Promise(resolve => setTimeout(() => resolve([]), 10000))
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
          const sourceNames = ['indeed', 'remoteok', 'linkedin'];
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await scraper.closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await scraper.closeBrowser();
  process.exit(0);
});

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
            skills: job.skills.slice(0, 3) // Show only top 3 skills in list
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
        message: 'The requested job ID does not exist or has expired'
      });
    }
    
    // Enhanced job details
    const enhancedJob = {
      ...job,
      // Add related jobs (by skills or company)
      relatedJobs: getRelatedJobs(job),
      // Add application tips
      applicationTips: getApplicationTips(job),
      // Add company info placeholder
      companyInfo: {
        size: 'Unknown',
        industry: 'Technology',
        website: null
      }
    };
    
    const response = {
      success: true,
      job: enhancedJob,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId
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
    let categoriesToFetch = [];
    
    if (category) {
      // Find specific category
      const foundCategory = CONFIG.trendingCategories.find(cat => cat.name === category);
      if (foundCategory) {
        categoriesToFetch = [foundCategory];
      }
    } else {
      // Get top 5 trending categories
      categoriesToFetch = CONFIG.trendingCategories.slice(0, 5);
    }
    
    // Fetch jobs for each category
    const fetchPromises = categoriesToFetch.map(cat => 
      scraper.searchJobs(cat.keywords, '')
    );
    
    const results = await Promise.allSettled(fetchPromises);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        const categoryJobs = result.value.jobs.slice(0, Math.floor(limit / categoriesToFetch.length));
        trendingJobs.push(...categoryJobs.map(job => ({
          ...job,
          category: categoriesToFetch[index].title
        })));
      }
    });
    
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
        categories: categoriesToFetch.map(cat => ({
          name: cat.name,
          title: cat.title,
          keywords: cat.keywords
        }))
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
      jobCount: Math.floor(Math.random() * 1000) + 100, // Simulated count
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
    
    CONFIG.cache.set(cacheKey, response, 1800); // Cache for 30 minutes
    
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

// Quick search endpoint (default to 'developer' jobs)
app.get('/api/search', async (req, res) => {
  try {
    const searchResult = await scraper.searchJobs('developer', '');
    
    const response = {
      success: true,
      message: 'Showing latest developer jobs. Use /api/search/{keywords}/{location} for custom search.',
      results: {
        jobs: searchResult.jobs.slice(0, 20),
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
    
    // Generate sample stats
    const stats = {
      totalJobsIndexed: jobsStore.size,
      activeSources: Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled),
      popularKeywords: CONFIG.trendingCategories.slice(0, 5).map(cat => cat.keywords),
      cachePerformance: CONFIG.cache.getStats(),
      lastUpdated: new Date().toISOString(),
      trendingCategories: CONFIG.trendingCategories.slice(0, 3).map(cat => ({
        name: cat.name,
        title: cat.title,
        jobCount: Math.floor(Math.random() * 500) + 100
      }))
    };
    
    const response = {
      success: true,
      stats,
      cached: false,
      timestamp: new Date().toISOString()
    };
    
    CONFIG.cache.set(cacheKey, response, 300); // Cache for 5 minutes
    
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

// Clear cache endpoint (admin)
app.post('/api/admin/cache/clear', (req, res) => {
  try {
    const { auth } = req.body;
    
    // Simple auth check
    if (!process.env.ADMIN_SECRET || auth !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        message: 'Invalid admin secret'
      });
    }
    
    const stats = CONFIG.cache.getStats();
    CONFIG.cache.flushAll();
    
    logger.info('Cache cleared', { 
      requestId: req.requestId,
      previousStats: stats 
    });
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
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
// HELPER FUNCTIONS
// ========================
function getRelatedJobs(job) {
  const related = [];
  const allJobs = Array.from(jobsStore.values());
  
  // Find jobs with similar skills
  if (job.skills && job.skills.length > 0) {
    allJobs.forEach(otherJob => {
      if (otherJob.id !== job.id) {
        const commonSkills = job.skills.filter(skill => 
          otherJob.skills.includes(skill)
        );
        if (commonSkills.length > 0) {
          related.push({
            id: otherJob.id,
            title: otherJob.title,
            company: otherJob.company,
            location: otherJob.location,
            salary: otherJob.salary,
            commonSkills: commonSkills.slice(0, 3)
          });
        }
      }
    });
  }
  
  // Find jobs from same company
  const companyJobs = allJobs.filter(otherJob => 
    otherJob.id !== job.id && 
    otherJob.company.toLowerCase() === job.company.toLowerCase()
  ).slice(0, 2);
  
  related.push(...companyJobs.map(j => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    salary: j.salary,
    reason: 'Same company'
  })));
  
  return related.slice(0, 5); // Return top 5 related jobs
}

function getApplicationTips(job) {
  const tips = [
    'Tailor your resume to match the job description keywords',
    'Highlight relevant skills and experience',
    'Research the company before applying',
    'Write a customized cover letter',
    'Follow up after 1-2 weeks if no response'
  ];
  
  if (job.skills && job.skills.length > 0) {
    tips.push(`Emphasize these skills: ${job.skills.slice(0, 3).join(', ')}`);
  }
  
  if (job.remote) {
    tips.push('Mention your remote work experience and self-discipline');
  }
  
  return tips;
}

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
    Total Endpoints: 8
    `);
  });
}

// Export for Vercel
module.exports = app;
