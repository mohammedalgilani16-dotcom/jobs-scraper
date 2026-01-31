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
  // Cache configuration (10 minutes TTL for job data)
  cache: new NodeCache({ stdTTL: 600, checkperiod: 120 }),
  
  // Request timeout (30 seconds)
  requestTimeout: 30000,
  
  // Max concurrent puppeteer instances
  maxConcurrentBrowsers: 2,
  
  // Max jobs per response
  maxJobsPerResponse: 50,
  
  // Job sources configuration
  sources: {
    indeed: {
      baseUrl: 'https://www.indeed.com/jobs',
      enabled: true,
      priority: 1,
      requiresBrowser: false
    },
    linkedin: {
      baseUrl: 'https://www.linkedin.com/jobs/search',
      enabled: true,
      priority: 2,
      requiresBrowser: true
    },
    remoteok: {
      baseUrl: 'https://remoteok.com/remote',
      enabled: true,
      priority: 3,
      requiresBrowser: false
    },
    weworkremotely: {
      baseUrl: 'https://weworkremotely.com/categories/remote-programming-jobs',
      enabled: true,
      priority: 4,
      requiresBrowser: false
    }
  }
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
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
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
  const requestId = uuidv4();
  req.requestId = requestId;
  
  logger.info({
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  });
  
  res.on('finish', () => {
    logger.info({
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: Date.now() - req.startTime,
      timestamp: new Date().toISOString()
    });
  });
  
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

const normalizeJobData = (job, source) => {
  const isRemote = source === 'remoteok' || source === 'weworkremotely' || 
                  (job.location && job.location.toLowerCase().includes('remote'));
  
  return {
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
    relevanceScore: calculateRelevanceScore(job)
  };
};

const calculateRelevanceScore = (job) => {
  let score = 50; // Base score
  
  // Boost score for complete data
  if (job.title && job.company) score += 20;
  if (job.salary) score += 15;
  if (job.description && job.description.length > 50) score += 10;
  if (job.url) score += 5;
  
  return Math.min(100, score); // Cap at 100
};

// ========================
// SCRAPER FUNCTIONS
// ========================
class JobScraper {
  constructor() {
    this.browser = null;
    this.browserPromise = null;
  }

  async getBrowser() {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080'
        ],
        timeout: CONFIG.requestTimeout
      });
    }
    if (!this.browser) {
      this.browser = await this.browserPromise;
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.browserPromise = null;
    }
  }

  async scrapeIndeed(keywords, location) {
    try {
      const url = new URL(CONFIG.sources.indeed.baseUrl);
      url.searchParams.append('q', keywords || 'developer');
      url.searchParams.append('l', location || '');
      
      logger.info(`Scraping Indeed: ${url.toString()}`);
      
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      $('.job_seen_beacon').each((i, element) => {
        const title = $(element).find('.jobTitle').text();
        const company = $(element).find('.companyName').text();
        const locationText = $(element).find('.companyLocation').text();
        const salary = $(element).find('.salary-snippet').text();
        const description = $(element).find('.job-snippet').text();
        const urlElement = $(element).find('.jcs-JobTitle');
        const url = urlElement.attr('href');
        
        if (title && company) {
          const job = {
            title,
            company,
            location: locationText,
            salary,
            description,
            url: url ? `https://indeed.com${url}` : null
          };
          jobs.push(normalizeJobData(job, 'indeed'));
        }
      });
      
      return jobs.slice(0, 15); // Return top 15 from Indeed
    } catch (error) {
      logger.error('Indeed scraping error:', error.message);
      return [];
    }
  }

  async scrapeLinkedIn(keywords, location) {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      const url = new URL(CONFIG.sources.linkedin.baseUrl);
      url.searchParams.append('keywords', keywords || 'developer');
      url.searchParams.append('location', location || '');
      
      logger.info(`Scraping LinkedIn: ${url.toString()}`);
      
      await page.goto(url.toString(), {
        waitUntil: 'networkidle2',
        timeout: CONFIG.requestTimeout
      });
      
      // Wait for job cards to load
      await page.waitForSelector('.base-card', { timeout: 15000 });
      
      // Scroll to load more jobs
      await page.evaluate(() => {
        window.scrollBy(0, 2000);
      });
      await page.waitForTimeout(3000);
      
      // Extract job data
      const jobs = await page.evaluate(() => {
        const jobElements = document.querySelectorAll('.base-card');
        const jobList = [];
        
        jobElements.forEach(element => {
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
        });
        
        return jobList;
      });
      
      await page.close();
      
      return jobs.slice(0, 15).map(job => normalizeJobData(job, 'linkedin'));
    } catch (error) {
      logger.error('LinkedIn scraping error:', error.message);
      return [];
    }
  }

  async scrapeRemoteOK(keywords) {
    try {
      const url = `${CONFIG.sources.remoteok.baseUrl}-${keywords || 'developer'}-jobs`;
      
      logger.info(`Scraping RemoteOK: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      $('tr.job').each((i, element) => {
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
            url: urlElement ? `https://remoteok.com${urlElement}` : null
          };
          jobs.push(normalizeJobData(job, 'remoteok'));
        }
      });
      
      return jobs.slice(0, 10);
    } catch (error) {
      logger.error('RemoteOK scraping error:', error.message);
      return [];
    }
  }

  async scrapeWeWorkRemotely(keywords) {
    try {
      const url = CONFIG.sources.weworkremotely.baseUrl;
      
      logger.info(`Scraping WeWorkRemotely: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: CONFIG.requestTimeout
      });
      
      const $ = cheerio.load(response.data);
      const jobs = [];
      
      $('.jobs li').each((i, element) => {
        const title = $(element).find('.title').text();
        const company = $(element).find('.company').text();
        const urlElement = $(element).find('a').attr('href');
        const description = '';
        
        if (title && company) {
          const job = {
            title,
            company,
            location: 'Remote',
            description,
            url: urlElement ? `https://weworkremotely.com${urlElement}` : null
          };
          jobs.push(normalizeJobData(job, 'weworkremotely'));
        }
      });
      
      // Filter by keywords if provided
      let filteredJobs = jobs;
      if (keywords) {
        const keywordLower = keywords.toLowerCase();
        filteredJobs = jobs.filter(job => 
          job.title.toLowerCase().includes(keywordLower) ||
          job.description.toLowerCase().includes(keywordLower)
        );
      }
      
      return filteredJobs.slice(0, 10);
    } catch (error) {
      logger.error('WeWorkRemotely scraping error:', error.message);
      return [];
    }
  }

  async searchJobs(keywords = 'developer', location = '') {
    try {
      const cacheKey = generateCacheKey(keywords, location);
      const cachedData = CONFIG.cache.get(cacheKey);
      
      if (cachedData) {
        logger.info(`Cache hit for: ${keywords} in ${location}`);
        return cachedData;
      }
      
      logger.info(`Starting job search: ${keywords} in ${location}`);
      
      // Scrape from all enabled sources concurrently
      const scrapePromises = [];
      
      if (CONFIG.sources.indeed.enabled) {
        scrapePromises.push(this.scrapeIndeed(keywords, location));
      }
      
      if (CONFIG.sources.linkedin.enabled) {
        scrapePromises.push(this.scrapeLinkedIn(keywords, location));
      }
      
      if (CONFIG.sources.remoteok.enabled) {
        scrapePromises.push(this.scrapeRemoteOK(keywords));
      }
      
      if (CONFIG.sources.weworkremotely.enabled) {
        scrapePromises.push(this.scrapeWeWorkRemotely(keywords));
      }
      
      const results = await Promise.allSettled(scrapePromises);
      
      // Combine all jobs
      let allJobs = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allJobs = allJobs.concat(result.value);
        } else {
          logger.error(`Scraping failed for source ${index}:`, result.reason);
        }
      });
      
      // Remove duplicates (by title and company)
      const uniqueJobs = [];
      const seen = new Set();
      
      allJobs.forEach(job => {
        const key = `${job.title.toLowerCase()}-${job.company.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueJobs.push(job);
        }
      });
      
      // Sort by relevance score (descending)
      uniqueJobs.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      // Take top N jobs
      const topJobs = uniqueJobs.slice(0, CONFIG.maxJobsPerResponse);
      
      const result = {
        jobs: topJobs,
        total: topJobs.length,
        keywords,
        location,
        timestamp: new Date().toISOString()
      };
      
      // Cache the result
      CONFIG.cache.set(cacheKey, result);
      
      return result;
    } catch (error) {
      logger.error('Search jobs error:', error);
      throw new Error(`Job search failed: ${error.message}`);
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
      keys: cacheStats.keys,
      size: cacheStats.ksize
    },
    config: {
      maxJobs: CONFIG.maxJobsPerResponse,
      sources: Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled)
    }
  });
});

// Main search endpoint - Simplified as requested
app.get('/api/search/:keywords/:location?', 
  [
    query('remote').optional().isBoolean().toBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: 'Invalid parameters',
          details: errors.array() 
        });
      }
      
      const { keywords, location = '' } = req.params;
      const { remote } = req.query;
      
      if (!keywords || keywords.trim().length === 0) {
        return res.status(400).json({
          error: 'Keywords are required',
          message: 'Please provide job search keywords'
        });
      }
      
      logger.info(`Search request: ${keywords} in ${location || 'anywhere'}${remote ? ' (remote only)' : ''}`);
      
      // Search for jobs
      const searchResult = await scraper.searchJobs(keywords, location);
      
      // Filter remote jobs if requested
      let filteredJobs = searchResult.jobs;
      if (remote === true) {
        filteredJobs = searchResult.jobs.filter(job => job.remote === true);
      }
      
      // Calculate statistics
      const stats = {
        totalJobs: filteredJobs.length,
        remoteJobs: filteredJobs.filter(job => job.remote).length,
        sources: [...new Set(filteredJobs.map(job => job.source))],
        averageRelevance: filteredJobs.length > 0 
          ? Math.round(filteredJobs.reduce((sum, job) => sum + job.relevanceScore, 0) / filteredJobs.length)
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
          jobs: filteredJobs,
          count: filteredJobs.length,
          stats
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
          cached: false
        }
      };
      
      res.json(response);
      
    } catch (error) {
      logger.error('Search endpoint error:', {
        error: error.message,
        stack: error.stack,
        requestId: req.requestId,
        params: req.params
      });
      
      res.status(500).json({
        error: 'Search failed',
        message: error.message,
        requestId: req.requestId,
        timestamp: new Date().toISOString()
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
        requestId: req.requestId
      }
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Quick search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get job statistics (simple version)
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
    
    // Sample recent search to get some stats
    const sampleSearch = await scraper.searchJobs('developer', '');
    
    const stats = {
      totalJobsIndexed: sampleSearch.total * 10, // Estimated
      activeSources: Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled),
      popularKeywords: ['developer', 'software engineer', 'remote', 'frontend', 'backend'],
      cachePerformance: CONFIG.cache.getStats(),
      lastUpdated: new Date().toISOString()
    };
    
    CONFIG.cache.set(cacheKey, stats, 300); // Cache for 5 minutes
    
    res.json({
      success: true,
      stats,
      cached: false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Stats endpoint error:', error);
    res.status(500).json({
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
    if (auth !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ 
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
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.url} does not exist`,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'GET /api/health',
      'GET /api/search/:keywords/:location?',
      'GET /api/search',
      'GET /api/stats',
      'POST /api/admin/cache/clear'
    ]
  });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

// ========================
// SERVER START
// ========================
app.listen(PORT, () => {
  logger.info(`Jobs Scraper API server running on port ${PORT}`);
  console.log(`
  💼 Jobs Scraper API Server Started!
  ===================================
  Port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  Health Check: http://localhost:${PORT}/api/health
  Search Endpoint: http://localhost:${PORT}/api/search/{keywords}/{location}
  Max Jobs: ${CONFIG.maxJobsPerResponse}
  Active Sources: ${Object.keys(CONFIG.sources).filter(s => CONFIG.sources[s].enabled).join(', ')}
  `);
});

// Export for testing
module.exports = app;
