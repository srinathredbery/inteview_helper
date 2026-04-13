const fs = require('fs');
const path = require('path');

class SearchEngine {
    constructor(jsonPath) {
        this.jsonPath = jsonPath;
        this.documents = [];
        this.idf = {};
        this.stopwords = new Set(['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't"]);
        this.loadDocuments();
    }

    loadDocuments() {
        try {
            const data = fs.readFileSync(this.jsonPath, 'utf8');
            const json = JSON.parse(data);
            this.documents = json.map(doc => ({
                ...doc,
                tokens: this.tokenize(doc.question),
                keywordTokens: (doc.keywords || []).flatMap(k => this.tokenize(k))
            }));
            this.calculateIDF();
            console.log(`[SearchEngine] Successfully loaded ${this.documents.length} documents.`);
        } catch (e) {
            console.error("Failed to load search documents:", e);
        }
    }

    // Simple Stemmer (Porter-lite)
    stem(word) {
        word = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (word.length < 3) return word;
        if (word.endsWith('ies')) return word.slice(0, -3) + 'i';
        if (word.endsWith('esses')) return word.slice(0, -3); // weaknesses -> weakness
        if (word.endsWith('sses')) return word; // weakness -> weakness
        if (word.endsWith('es')) return word.slice(0, -2); // matches -> match
        if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
        if (word.endsWith('ing')) return word.slice(0, -3);
        if (word.endsWith('ed')) return word.slice(0, -2);
        return word;
    }

    tokenize(text) {
        if (!text) return [];
        return text.toLowerCase()
            .split(/[\s,?.!]+/)
            .filter(t => t && !this.stopwords.has(t))
            .map(t => this.stem(t));
    }

    calculateIDF() {
        const N = this.documents.length;
        const docFreq = {};
        
        this.documents.forEach(doc => {
            const uniqueTokens = new Set(doc.tokens);
            uniqueTokens.forEach(token => {
                docFreq[token] = (docFreq[token] || 0) + 1;
            });
        });

        for (const token in docFreq) {
            this.idf[token] = Math.log((N + 1) / (docFreq[token] + 1)) + 1;
        }
    }

    search(query) {
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) return null;

        let bestMatch = null;
        let maxScore = -1;

        this.documents.forEach(doc => {
            let score = 0;
            const docTokens = doc.tokens;
            const termCounts = {};
            
            docTokens.forEach(t => termCounts[t] = (termCounts[t] || 0) + 1);

            queryTokens.forEach(token => {
                const tf = (termCounts[token] || 0) / docTokens.length;
                const idf = this.idf[token] || 1;
                score += tf * idf;

                // Keyword boost: +0.30 if any query stem matches a JSON keyword stem
                if (doc.keywordTokens.includes(token)) {
                    score += 0.30;
                }
            });

            if (score > maxScore) {
                maxScore = score;
                bestMatch = { ...doc, score };
            }
        });

        // Threshold to avoid weak matches
        console.log(`[SearchEngine] Query: "${query}" | Best Match: "${bestMatch ? bestMatch.question : 'None'}" | Score: ${maxScore.toFixed(3)}`);
        return (maxScore > 0.05) ? bestMatch : null;
    }
}

module.exports = SearchEngine;
